package tosapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func credentialRequest() *http.Request {
	r := httptest.NewRequest("GET", "http://nas/api/info", nil)
	r.Header.Set("Cookie", "TMSESSNAME=secret-session; X-Csrf-Token=secret-csrf; unrelated=private")
	r.Header.Set("X-Csrf-Token", "secret-csrf")
	return r
}

func TestCredentialsForwardOnlyRequiredSecrets(t *testing.T) {
	credentials, err := ReadCredentials(credentialRequest())
	if err != nil {
		t.Fatal(err)
	}
	header := make(http.Header)
	if err := credentials.Apply(header); err != nil {
		t.Fatal(err)
	}
	if header.Get("Cookie") != "TMSESSNAME=secret-session; X-Csrf-Token=secret-csrf" || header.Get("X-Csrf-Token") != "secret-csrf" {
		t.Fatalf("wrong forwarded fields: %v", header)
	}
	encoded, err := json.Marshal(credentials)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{fmt.Sprint(credentials), fmt.Sprintf("%+v", credentials), fmt.Sprintf("%#v", credentials), string(encoded)} {
		if strings.Contains(text, "secret") || strings.Contains(text, "private") {
			t.Fatal("formatted credentials contain a secret")
		}
	}
	if len(credentials.SessionHash()) != 64 {
		t.Fatal("missing session isolation hash")
	}
	other := credentialRequest()
	other.Header.Set("Cookie", "TMSESSNAME=another; X-Csrf-Token=secret-csrf")
	otherCredentials, _ := ReadCredentials(other)
	if otherCredentials.SessionHash() == credentials.SessionHash() {
		t.Fatal("sessions share an isolation hash")
	}
	if (Credentials{}).SessionHash() != "" || (Credentials{}).Apply(header) == nil {
		t.Fatal("empty credentials accepted")
	}
}

func TestCredentialsRejectMissingMismatchedAndDuplicateFields(t *testing.T) {
	for _, change := range []func(*http.Request){
		func(r *http.Request) { r.Header.Del("Cookie") },
		func(r *http.Request) { r.Header.Del("X-Csrf-Token") },
		func(r *http.Request) { r.Header.Set("X-Csrf-Token", "wrong") },
		func(r *http.Request) { r.Header.Set("Cookie", "TMSESSNAME=; X-Csrf-Token=secret-csrf") },
		func(r *http.Request) { r.Header.Add("Cookie", "TMSESSNAME=other") },
		func(r *http.Request) { r.Header.Add("Cookie", "X-Csrf-Token=secret-csrf") },
		func(r *http.Request) { r.Header.Add("X-Csrf-Token", "secret-csrf") },
	} {
		r := credentialRequest()
		change(r)
		if _, err := ReadCredentials(r); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("invalid credentials result: %v", err)
		}
		called := false
		if _, err := Authenticate(r, func(context.Context, Credentials) error { called = true; return nil }); !errors.Is(err, ErrInvalidCredentials) || called {
			t.Fatal("invalid credentials reached platform verification")
		}
	}
}

func TestAuthenticateRequiresPlatformVerification(t *testing.T) {
	r := credentialRequest()
	if _, err := Authenticate(r, nil); !errors.Is(err, ErrVerifierRequired) {
		t.Fatal("local credentials accepted as proof of login")
	}
	rejected := errors.New("platform session expired")
	if credentials, err := Authenticate(r, func(context.Context, Credentials) error { return rejected }); !errors.Is(err, rejected) || credentials.SessionHash() != "" {
		t.Fatal("platform rejection lost or credentials exposed on failure")
	}
	key := struct{}{}
	r = r.WithContext(context.WithValue(r.Context(), key, "context-value"))
	if _, err := Authenticate(r, func(ctx context.Context, credentials Credentials) error {
		if ctx.Value(key) != "context-value" || credentials.SessionHash() == "" {
			t.Fatal("verification lost context or credentials")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Origin", "https://foreign")
	if _, err := Authenticate(r, func(context.Context, Credentials) error { t.Fatal("foreign source reached platform"); return nil }); !errors.Is(err, ErrOriginMismatch) {
		t.Fatal(err)
	}
}

func TestSameOriginGatewayAndNativeRequests(t *testing.T) {
	for _, tc := range []struct {
		host, origin, site string
		want               bool
	}{
		{"nas", "", "", true},
		{"nas:8181", "http://nas:8181", "same-origin", true},
		{"nas", "http://nas:8181", "", true},
		{"nas", "https://nas:8443", "", true},
		{"nas", "https://nas:5443", "", true},
		{"nas:5443", "https://nas:5443", "", true},
		{"192.0.2.2", "https://192.0.2.2:5443", "", true},
		{"nas", "http://nas:5443", "", false},
		{"nas:8181", "https://nas:5443", "", false},
		{"nas", "http://evil:8181", "", false},
		{"nas", "http://nas:9999", "", false},
		{"nas", "null", "", false},
		{"nas", "http://nas:8181/path", "", false},
		{"nas", "http://x@nas:8181", "", false},
		{"nas", "http://nas:8181?", "", false},
		{"nas", "https://nas:5443", "cross-site", false},
		{"nas", "", "cross-site", false},
	} {
		t.Run(tc.host+"/"+tc.origin+"/"+tc.site, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://nas/api/status", nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			r.Header.Set("Sec-Fetch-Site", tc.site)
			if got := SameOrigin(r); got != tc.want {
				t.Fatalf("SameOrigin = %v, want %v", got, tc.want)
			}
		})
	}
	r := httptest.NewRequest("GET", "http://nas/api/status", nil)
	r.Header.Add("Origin", "http://nas")
	r.Header.Add("Origin", "http://nas")
	if SameOrigin(r) {
		t.Fatal("multiple origins accepted")
	}
}

func TestAuthenticateHonorsCancellationBeforeAndDuringVerification(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := Authenticate(credentialRequest().WithContext(ctx), func(context.Context, Credentials) error { t.Fatal("cancelled request reached verifier"); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	ctx, cancel = context.WithCancel(t.Context())
	if credentials, err := Authenticate(credentialRequest().WithContext(ctx), func(context.Context, Credentials) error { cancel(); return nil }); !errors.Is(err, context.Canceled) || credentials.SessionHash() != "" {
		t.Fatal("cancelled verification succeeded")
	}
}

func TestPreflightIsConfigurableAndDoesNotRequireCredentials(t *testing.T) {
	r := httptest.NewRequest("OPTIONS", "http://nas/api/config", nil)
	r.Header.Set("Origin", "https://nas:5443")
	w := httptest.NewRecorder()
	if err := WritePreflight(w, r, []string{"GET", "PUT", "OPTIONS"}); err != nil {
		t.Fatal(err)
	}
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "https://nas:5443" || !strings.Contains(w.Header().Get("Access-Control-Allow-Methods"), "PUT") {
		t.Fatal("incomplete preflight response")
	}
	r.Header.Set("Origin", "https://foreign")
	w = httptest.NewRecorder()
	if err := WritePreflight(w, r, []string{"GET"}); !errors.Is(err, ErrOriginMismatch) || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("foreign preflight accepted")
	}
}
