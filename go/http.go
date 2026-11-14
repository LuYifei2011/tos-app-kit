package tosapp

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

var (
	ErrInvalidJSON  = errors.New("request JSON is invalid or exceeds the size limit")
	ErrTrailingJSON = errors.New("request contains trailing JSON")
)

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

// DecodeJSON accepts one JSON value, rejects unknown fields and limits bytes.
func DecodeJSON(w http.ResponseWriter, r *http.Request, value any, maxBytes int64) error {
	if maxBytes <= 0 {
		return ErrInvalidJSON
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return ErrInvalidJSON
	}
	if decoder.Decode(new(any)) != io.EOF {
		return ErrTrailingJSON
	}
	return nil
}

// StripAppPrefix handles either gateway path form, matching whole segments.
func StripAppPrefix(path, appID string) string {
	if !validAppID(appID) {
		return path
	}
	for _, prefix := range []string{"/v2/proxy/" + appID, "/" + appID} {
		if path == prefix {
			return "/"
		}
		if strings.HasPrefix(path, prefix+"/") {
			return strings.TrimPrefix(path, prefix)
		}
	}
	return path
}

// NewPlatformClient never uses environment proxies or follows redirects.
// Platform endpoints and response-envelope interpretation belong to the app.
func NewPlatformClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			MaxIdleConnsPerHost: 8, ResponseHeaderTimeout: 20 * time.Second, IdleConnTimeout: 30 * time.Second,
		},
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
