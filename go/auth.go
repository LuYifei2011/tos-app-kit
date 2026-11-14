// Package tosapp provides HTTP and service support for TOS applications.
package tosapp

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

var (
	ErrInvalidCredentials = errors.New("TOS session or CSRF credentials are invalid")
	ErrOriginMismatch     = errors.New("TOS request origin is not allowed")
	ErrVerifierRequired   = errors.New("a platform session verifier is required")
)

// Credentials contains request-scoped secrets. Do not persist it in jobs or logs.
// Reading these values does not establish that the platform session is valid.
type Credentials struct {
	session, csrfCookie, csrfHeader string
	sessionValue                    string
}

func (Credentials) String() string   { return "[TOS credentials]" }
func (Credentials) GoString() string { return "[TOS credentials]" }

// ReadCredentials checks presence and CSRF equality, without verifying login.
func ReadCredentials(r *http.Request) (Credentials, error) {
	sessions, csrfCookies := r.CookiesNamed("TMSESSNAME"), r.CookiesNamed("X-Csrf-Token")
	tokens := r.Header.Values("X-Csrf-Token")
	if len(sessions) != 1 || len(csrfCookies) != 1 || len(tokens) != 1 {
		return Credentials{}, ErrInvalidCredentials
	}
	session, csrf, token := sessions[0], csrfCookies[0], tokens[0]
	if session.Value == "" || csrf.Value == "" || token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(csrf.Value)) != 1 {
		return Credentials{}, ErrInvalidCredentials
	}
	return Credentials{session: session.String(), csrfCookie: csrf.String(), csrfHeader: token, sessionValue: session.Value}, nil
}

// Apply forwards only the session and CSRF credentials to a trusted upstream.
// The caller must choose a fixed platform URL, independent of user input.
func (c Credentials) Apply(header http.Header) error {
	if c.session == "" || c.csrfCookie == "" || c.csrfHeader == "" {
		return ErrInvalidCredentials
	}
	header.Set("Cookie", c.session+"; "+c.csrfCookie)
	header.Set("X-Csrf-Token", c.csrfHeader)
	return nil
}

// SessionHash is a session-scoped isolation key, not a user ID or proof of login.
func (c Credentials) SessionHash() string {
	if c.sessionValue == "" {
		return ""
	}
	hash := sha256.Sum256([]byte(c.sessionValue))
	return hex.EncodeToString(hash[:])
}

// SessionVerifier must ask the platform to validate the session. Applications
// retain control of the platform endpoint and any resource permission checks.
type SessionVerifier func(context.Context, Credentials) error

// Authenticate requires local checks and successful platform verification.
// Errors from verify are returned unchanged so applications can distinguish
// expired sessions, unavailable upstreams and denied resource access.
func Authenticate(r *http.Request, verify SessionVerifier) (Credentials, error) {
	credentials, err := ReadCredentials(r)
	if err != nil {
		return Credentials{}, err
	}
	if !SameOrigin(r) {
		return Credentials{}, ErrOriginMismatch
	}
	if verify == nil {
		return Credentials{}, ErrVerifierRequired
	}
	if err := r.Context().Err(); err != nil {
		return Credentials{}, err
	}
	if err := verify(r.Context(), credentials); err != nil {
		return Credentials{}, err
	}
	if err := r.Context().Err(); err != nil {
		return Credentials{}, err
	}
	return credentials, nil
}

// SameOrigin tolerates TOS gateways that strip the public port from Host.
// A missing Origin is allowed for gateway/native requests; authentication still
// requires CSRF and platform session verification through Authenticate.
func SameOrigin(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		return false
	}
	origins := r.Header.Values("Origin")
	if len(origins) == 0 {
		return true
	}
	if len(origins) != 1 {
		return false
	}
	u, err := url.Parse(origins[0])
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	proxyHost := &url.URL{Host: r.Host}
	platformPort := u.Port() == "8181" || u.Port() == "8443" || (u.Scheme == "https" && u.Port() == "5443")
	return proxyHost.Port() == "" && strings.EqualFold(u.Hostname(), proxyHost.Hostname()) && platformPort
}

// WritePreflight responds only to an allowed same-origin OPTIONS request.
// It deliberately does not verify sessions: browsers omit credentials here.
func WritePreflight(w http.ResponseWriter, r *http.Request, methods []string) error {
	if r.Method != http.MethodOptions || r.Header.Get("Origin") == "" || !SameOrigin(r) {
		return ErrOriginMismatch
	}
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Methods", strings.Join(methods, ", "))
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Csrf-Token, Cookie")
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Add("Vary", "Origin")
	w.WriteHeader(http.StatusNoContent)
	return nil
}
