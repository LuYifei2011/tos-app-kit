package tosapp

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONLimitsUnknownFieldsAndTrailingValues(t *testing.T) {
	for _, tc := range []struct {
		body  string
		limit int64
		want  error
	}{
		{`{"name":"ok"}`, 64, nil},
		{`{"name":"ok"}  `, 64, nil},
		{`{"extra":1}`, 64, ErrInvalidJSON},
		{`{`, 64, ErrInvalidJSON},
		{`{"name":"too large"}`, 5, ErrInvalidJSON},
		{`{"name":"ok"} {}`, 64, ErrTrailingJSON},
		{`{"name":"ok"} garbage`, 64, ErrTrailingJSON},
		{`{}`, 0, ErrInvalidJSON},
	} {
		t.Run(tc.body, func(t *testing.T) {
			r := httptest.NewRequest("PUT", "/api/config", strings.NewReader(tc.body))
			var value struct {
				Name string `json:"name"`
			}
			if err := DecodeJSON(httptest.NewRecorder(), r, &value, tc.limit); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
	w := httptest.NewRecorder()
	WriteJSON(w, 202, map[string]bool{"saved": true})
	if w.Code != 202 || w.Header().Get("Cache-Control") != "no-store" || w.Body.String() != "{\"saved\":true}\n" {
		t.Fatal("wrong JSON response")
	}
}

func TestProxyPrefixOnlyMatchesWholeApplicationSegment(t *testing.T) {
	for _, tc := range []struct{ path, want string }{
		{"/v2/proxy/example/api/status", "/api/status"},
		{"/example/api/status", "/api/status"},
		{"/api/status", "/api/status"},
		{"/example", "/"},
		{"/example-other/api/status", "/example-other/api/status"},
		{"/v2/proxy/example-other/api/status", "/v2/proxy/example-other/api/status"},
		{"/v2/proxy/example/example/api/status", "/example/api/status"},
	} {
		if got := StripAppPrefix(tc.path, "example"); got != tc.want {
			t.Fatalf("%q -> %q, want %q", tc.path, got, tc.want)
		}
	}
}

func TestPlatformClientNeverFollowsCredentialRedirectsOrEnvironmentProxies(t *testing.T) {
	visits := 0
	foreign := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { visits++ }))
	defer foreign.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, foreign.URL, 302) }))
	defer upstream.Close()
	client := NewPlatformClient()
	defer client.CloseIdleConnections()
	if client.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("environment proxies enabled")
	}
	credentials, _ := ReadCredentials(credentialRequest())
	r, _ := http.NewRequest("GET", upstream.URL, nil)
	if err := credentials.Apply(r.Header); err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 302 || visits != 0 {
		t.Fatal("credentials followed a redirect")
	}
}
