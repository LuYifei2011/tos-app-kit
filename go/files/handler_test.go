package files

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"strings"
	"sync"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func item(p, kind string) map[string]any {
	return map[string]any{"path": p, "name": path.Base(p), "f_type": kind}
}
func ok(data any) map[string]any { return map[string]any{"code": true, "is_login": true, "data": data} }
func failed(code int) map[string]any {
	return map[string]any{"code": false, "is_login": true, "code_num": code, "msg": "secret-upstream"}
}
func fixture(t *testing.T, options Options, reply func(*http.Request) any) *Handler {
	t.Helper()
	options.AppID = "example"
	h, err := NewHandler(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Close() })
	h.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" || r.Header.Get("X-Csrf-Token") != "csrf" || strings.Contains(r.Header.Get("Cookie"), "private") {
			t.Errorf("unexpected upstream request")
		}
		data, err := json.Marshal(reply(r))
		if err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})
	return h
}
func normal(r *http.Request) any {
	switch path.Base(r.URL.Path) {
	case "homeList":
		return ok([]any{item("/Volume1/docs", "folder"), item("/Volume1/@system", "folder")})
	case "folderInfoAll":
		return ok(item(r.URL.Query().Get("path"), "folder"))
	case "list":
		return ok(map[string]any{"total": 0, "data": []any{}})
	}
	panic("unexpected endpoint")
}
func request(h http.Handler, route, user string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "http://nas"+route, nil)
	r.Header.Set("Cookie", "TMSESSNAME="+user+"; X-Csrf-Token=csrf; userName="+user+"; unrelated=private")
	r.Header.Set("X-Csrf-Token", "csrf")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func endpoint(action, p string) string { return "/api/files/" + action + "?path=" + url.QueryEscape(p) }
func expect(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status || (code != "" && !strings.Contains(w.Body.String(), code)) {
		t.Fatalf("status %d: %s; want %d %s", w.Code, w.Body, status, code)
	}
	if strings.Contains(w.Body.String(), "secret-") {
		t.Fatal("leaked upstream details")
	}
}

func TestOptionalRegistrationAndGatewayRoutes(t *testing.T) {
	h := fixture(t, Options{}, normal)
	mux := http.NewServeMux()
	expect(t, request(mux, "/api/files/list", "alice"), 404, "")
	h.Register(mux)
	for _, prefix := range []string{"", "/example", "/v2/proxy/example"} {
		w := request(mux, prefix+"/api/files/list", "alice")
		expect(t, w, 200, "")
		var result Directory
		json.Unmarshal(w.Body.Bytes(), &result)
		if result.Directory != nil || result.ParentPath != nil || len(result.Entries) != 1 || result.Entries[0].Path != "/Volume1/docs" {
			t.Fatalf("wrong roots: %+v", result)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cache enabled")
		}
	}
	expect(t, request(mux, "/another/api/files/list", "alice"), 404, "")
}
func TestSessionIsolationAndCredentialForwarding(t *testing.T) {
	h := fixture(t, Options{}, func(r *http.Request) any {
		cookie, _ := r.Cookie("TMSESSNAME")
		username, _ := r.Cookie("userName")
		if username == nil || username.Value != cookie.Value {
			t.Error("username not forwarded")
		}
		return ok([]any{item("/Volume1/"+cookie.Value, "folder")})
	})
	var wg sync.WaitGroup
	for _, user := range []string{"alice", "bob"} {
		wg.Go(func() {
			w := request(h, "/api/files/list", user)
			expect(t, w, 200, "")
			if !strings.Contains(w.Body.String(), "/Volume1/"+user) {
				t.Errorf("cross-session roots: %s", w.Body)
			}
		})
	}
	wg.Wait()
}
func TestAuthenticationAndMethods(t *testing.T) {
	calls := 0
	h := fixture(t, Options{}, func(r *http.Request) any { calls++; return normal(r) })
	for _, tc := range []struct {
		method, cookie, csrf, origin string
		status                       int
	}{
		{"GET", "", "", "", 401}, {"GET", "TMSESSNAME=a; X-Csrf-Token=csrf", "wrong", "", 401},
		{"GET", "TMSESSNAME=a; X-Csrf-Token=csrf", "csrf", "http://evil", 403},
		{"GET", "TMSESSNAME=a; X-Csrf-Token=csrf; userName=a; userName=b", "csrf", "", 401},
		{"POST", "", "", "", 405}, {"OPTIONS", "", "", "http://nas", 204},
	} {
		r := httptest.NewRequest(tc.method, "http://nas/api/files/list", nil)
		r.Header.Set("Cookie", tc.cookie)
		r.Header.Set("X-Csrf-Token", tc.csrf)
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		expect(t, w, tc.status, "")
	}
	if calls != 0 {
		t.Fatal("invalid requests reached platform")
	}
}
func TestPathAndRootBoundaries(t *testing.T) {
	h := fixture(t, Options{}, normal)
	for _, p := range []string{"/etc/passwd", "/Volume1/docs/../other", "/Volume1/docs//a", "/Volume1/docs/", "/Volume1/docs\\a", "/Volume1/docs/@hidden", "/Volume1/docs/#recycle", "/Volume1/homes", "/Volume1/docs/\x00"} {
		expect(t, request(h, endpoint("stat", p), "alice"), 400, "FILE_INVALID_PATH")
	}
	for _, p := range []string{"/Volume1/docs-other", "/Volume2/docs"} {
		expect(t, request(h, endpoint("list", p), "alice"), 409, "FILE_ACCESS_DENIED")
	}
	for _, q := range []string{"?path=a&path=b", "?unknown=a", "?path=%zz"} {
		expect(t, request(h, "/api/files/list"+q, "alice"), 400, "")
	}
	if !safePath("/Volume1/homes/alice/中文 #?.txt") {
		t.Fatal("valid path rejected")
	}
}
func TestAllowedRoots(t *testing.T) {
	allowed := []string{"/Volume1/docs/sub"}
	h := fixture(t, Options{AllowedRoots: allowed}, normal)
	allowed[0] = "/Volume1/docs"
	expect(t, request(h, endpoint("list", "/Volume1/docs"), "alice"), 409, "")
	w := request(h, endpoint("list", "/Volume1/docs/sub"), "alice")
	expect(t, w, 200, "")
	var data Directory
	json.Unmarshal(w.Body.Bytes(), &data)
	if data.ParentPath != nil {
		t.Fatal("navigation escaped configured root")
	}
	empty := fixture(t, Options{AllowedRoots: []string{}}, normal)
	w = request(empty, "/api/files/list", "alice")
	expect(t, w, 200, "")
	json.Unmarshal(w.Body.Bytes(), &data)
	if data.Entries == nil || len(data.Entries) != 0 {
		t.Fatal("empty allowlist allows access")
	}
	expect(t, request(empty, endpoint("stat", "/Volume1/docs/a"), "alice"), 409, "")
}
func TestStatMissingLeafVersusErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		data   any
		status int
		code   string
	}{
		{"missing", failed(104), 200, `"entry":null`}, {"denied", failed(90), 409, "FILE_ACCESS_DENIED"},
		{"expired", failed(117), 401, "TOS_SESSION_EXPIRED"}, {"malformed", map[string]any{"code": true}, 502, "FILE_UPSTREAM_INVALID"},
		{"wrong-path", ok(item("/Volume1/docs/other", "file")), 502, "FILE_UPSTREAM_INVALID"},
		{"link", ok(item("/Volume1/docs/a", "app_link")), 409, "FILE_ACCESS_DENIED"},
		{"file", ok(item("/Volume1/docs/a", "file")), 200, `"kind":"file"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := fixture(t, Options{}, func(r *http.Request) any {
				if r.URL.Query().Get("path") == "/Volume1/docs/a" {
					return tc.data
				}
				return normal(r)
			})
			expect(t, request(h, endpoint("stat", "/Volume1/docs/a"), "alice"), tc.status, tc.code)
		})
	}
	for _, kind := range []string{"missing", "link"} {
		h := fixture(t, Options{}, func(r *http.Request) any {
			if r.URL.Query().Get("path") == "/Volume1/docs/sub" {
				if kind == "missing" {
					return failed(104)
				}
				return ok(item("/Volume1/docs/sub", "app_link"))
			}
			return normal(r)
		})
		w := request(h, endpoint("stat", "/Volume1/docs/sub/new.txt"), "alice")
		if w.Code == 200 {
			t.Fatal("invalid parent accepted as a save destination")
		}
	}
}
func TestCompletePaginationAndMetadata(t *testing.T) {
	h := fixture(t, Options{}, func(r *http.Request) any {
		if path.Base(r.URL.Path) != "list" {
			return normal(r)
		}
		items := []any{item("/Volume1/docs/z.txt", "file"), item("/Volume1/docs/link", "app_link")}
		if r.URL.Query().Get("page") == "2" {
			folder := item("/Volume1/docs/a", "folder")
			folder["size"] = 123
			folder["m_time_stamp"] = 1700000000
			items = []any{folder}
		}
		return ok(map[string]any{"total": 3, "data": items})
	})
	w := request(h, endpoint("list", "/Volume1/docs"), "alice")
	expect(t, w, 200, "")
	var d Directory
	json.Unmarshal(w.Body.Bytes(), &d)
	if len(d.Entries) != 2 || d.Entries[0].Kind != "directory" || *d.Entries[0].Size != 123 || d.Entries[0].ModifiedAt != "2023-11-14T22:13:20Z" {
		t.Fatalf("invalid listing: %+v", d)
	}
}
func TestListingsFailClosed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		total  int
		items  []any
		status int
	}{
		{"duplicate", 3, []any{item("/Volume1/docs/a", "file")}, 409},
		{"truncated", 1, []any{}, 409}, {"escape", 1, []any{item("/Volume1/other/a", "file")}, 502},
		{"too-many", 11, []any{}, 413}, {"null-data", 0, nil, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := fixture(t, Options{MaxEntries: 10}, func(r *http.Request) any {
				if path.Base(r.URL.Path) == "list" {
					return ok(map[string]any{"total": tc.total, "data": tc.items})
				}
				return normal(r)
			})
			expect(t, request(h, endpoint("list", "/Volume1/docs"), "alice"), tc.status, "")
		})
	}
}
func TestCancellationAndTimeout(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		h := fixture(t, Options{RequestTimeout: time.Millisecond}, normal)
		h.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() })
		r := httptest.NewRequest("GET", "http://nas/api/files/list", nil)
		r.Header.Set("Cookie", "TMSESSNAME=a; X-Csrf-Token=csrf")
		r.Header.Set("X-Csrf-Token", "csrf")
		expected := 504
		if cancelled {
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			r = r.WithContext(ctx)
			expected = 408
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		expect(t, w, expected, "")
	}
}
func TestRedirectDoesNotForwardCredentials(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer source.Close()
	h, err := NewHandler(Options{AppID: "example", PlatformURL: source.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	expect(t, request(h, "/api/files/list", "alice"), 503, "")
	if reached {
		t.Fatal("followed upstream redirect")
	}
}
func TestConfiguration(t *testing.T) {
	for _, o := range []Options{{}, {AppID: "../bad"}, {AppID: "example", PlatformURL: "http://example.com"}, {AppID: "example", PlatformURL: "http://127.0.0.1/path"}, {AppID: "example", PlatformURL: "http://user:pass@127.0.0.1"}, {AppID: "example", PathPrefix: "/api/../files"}, {AppID: "example", MaxEntries: -1}, {AppID: "example", RequestTimeout: -1}, {AppID: "example", AllowedRoots: []string{"/etc"}}} {
		if h, err := NewHandler(o); err == nil {
			h.Close()
			t.Fatalf("invalid options accepted: %+v", o)
		}
	}
}
