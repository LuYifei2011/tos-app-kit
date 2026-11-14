// Package files is an opt-in, read-only NAS file-selection service for TOS 7.
// Importing it does not register routes, open files, or start a server.
package files

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	tosapp "github.com/LuYifei2011/tos-app-kit/go"
)

// Options configures a service whose paths always remain inside the current
// TOS user's shared folders. All configuration must come from the application.
type Options struct {
	AppID string
	// PathPrefix defaults to /api/files, relative to the application's gateway prefix.
	PathPrefix string
	// AllowedRoots further limits TOS permissions. nil allows the user's shares;
	// a non-nil empty slice allows none. Entries may be shares or subdirectories.
	AllowedRoots []string
	// PlatformURL defaults to http://127.0.0.1:8181. Only literal loopback hosts
	// are accepted; redirects and environment proxies are never followed.
	PlatformURL string
	// RequestTimeout bounds the entire operation, including all upstream pages.
	// Zero defaults to 25 seconds.
	RequestTimeout time.Duration
	// MaxEntries limits a complete listing. Zero defaults to 100,000.
	MaxEntries int
}

type Entry struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Size       *int64 `json:"size,omitempty"`
	ModifiedAt string `json:"modifiedAt,omitempty"`
}
type Directory struct {
	Directory  *Entry  `json:"directory"`
	ParentPath *string `json:"parentPath"`
	Entries    []Entry `json:"entries"`
}
type StatResult struct {
	Entry *Entry `json:"entry"`
}

type Handler struct {
	appID, prefix, platformURL string
	allowed                    []string
	timeout                    time.Duration
	maxEntries                 int
	client                     *http.Client
}

var appIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
var routePattern = regexp.MustCompile(`^(/[a-zA-Z0-9_~-]+)+$`)

func NewHandler(options Options) (*Handler, error) {
	if !appIDPattern.MatchString(options.AppID) {
		return nil, errors.New("files: valid AppID is required")
	}
	if options.PathPrefix == "" {
		options.PathPrefix = "/api/files"
	}
	if !routePattern.MatchString(options.PathPrefix) {
		return nil, errors.New("files: invalid PathPrefix")
	}
	if options.PlatformURL == "" {
		options.PlatformURL = "http://127.0.0.1:8181"
	}
	u, err := url.Parse(options.PlatformURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || !net.ParseIP(u.Hostname()).IsLoopback() || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, errors.New("files: PlatformURL must be a loopback HTTP(S) origin")
	}
	if options.RequestTimeout == 0 {
		options.RequestTimeout = 25 * time.Second
	}
	if options.RequestTimeout < 0 {
		return nil, errors.New("files: RequestTimeout must be positive")
	}
	if options.MaxEntries == 0 {
		options.MaxEntries = 100000
	}
	if options.MaxEntries < 1 || options.MaxEntries > 100000 {
		return nil, errors.New("files: MaxEntries must be between 1 and 100000")
	}
	var allowed []string
	if options.AllowedRoots != nil {
		allowed = make([]string, 0, len(options.AllowedRoots))
		for _, root := range options.AllowedRoots {
			if !safePath(root) {
				return nil, errors.New("files: invalid allowed root")
			}
			allowed = append(allowed, root)
		}
	}
	return &Handler{appID: options.AppID, prefix: options.PathPrefix, platformURL: u.String(), allowed: allowed, timeout: options.RequestTimeout, maxEntries: options.MaxEntries, client: tosapp.NewPlatformClient()}, nil
}

// Register explicitly mounts the routes on the supplied mux, including both
// TOS gateway path forms. It never modifies http.DefaultServeMux.
func (h *Handler) Register(mux *http.ServeMux) {
	for _, prefix := range []string{"", "/" + h.appID, "/v2/proxy/" + h.appID} {
		mux.Handle(prefix+h.prefix+"/", h)
	}
}

// Close releases idle upstream connections during application shutdown.
func (h *Handler) Close() error { h.client.CloseIdleConnections(); return nil }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	endpoint := tosapp.StripAppPrefix(r.URL.Path, h.appID)
	if endpoint != h.prefix+"/list" && endpoint != h.prefix+"/stat" {
		respondError(w, notFound)
		return
	}
	if r.Method == http.MethodOptions {
		if tosapp.WritePreflight(w, r, []string{"GET", "OPTIONS"}) != nil {
			respondError(w, originDenied)
		}
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, OPTIONS")
		respondError(w, methodDenied)
		return
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query["path"]) > 1 || len(query) > 1 || (len(query) == 1 && !query.Has("path")) {
		respondError(w, invalidPath)
		return
	}
	requested := query.Get("path")
	if (requested == "" && endpoint == h.prefix+"/stat") || (requested != "" && !safePath(requested)) {
		respondError(w, invalidPath)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()
	var session *platformSession
	var shares []Entry
	_, err = tosapp.Authenticate(r.WithContext(ctx), func(ctx context.Context, credentials tosapp.Credentials) error {
		usernames := r.CookiesNamed("userName")
		if len(usernames) > 1 {
			return tosapp.ErrInvalidCredentials
		}
		session = &platformSession{handler: h, credentials: credentials}
		if len(usernames) == 1 {
			session.username = usernames[0].String()
		}
		var err error
		shares, err = session.shares(ctx)
		return err
	})
	if err != nil {
		respondError(w, err)
		return
	}
	roots, err := session.roots(ctx, shares)
	if err != nil {
		respondError(w, err)
		return
	}
	if requested == "" {
		tosapp.WriteJSON(w, 200, Directory{Entries: roots})
		return
	}
	root := containingRoot(roots, requested)
	if root == nil {
		respondError(w, accessDenied)
		return
	}
	if endpoint == h.prefix+"/stat" {
		var entry *Entry
		if requested == root.Path {
			entry, err = session.directory(ctx, shares, requested)
		} else {
			_, err = session.directory(ctx, shares, path.Dir(requested))
			if err == nil {
				entry, err = session.info(ctx, requested)
			}
			// Only an explicit not-found for the leaf means a new save target. A missing
			// or inaccessible parent must fail instead of authorizing a save location.
			if errors.Is(err, missingLeaf) {
				// directory() maps its missing parents to missingDirectory.
				err = nil
			}
		}
		if err != nil {
			respondError(w, err)
			return
		}
		tosapp.WriteJSON(w, 200, StatResult{Entry: entry})
		return
	}
	directory, err := session.directory(ctx, shares, requested)
	if err != nil {
		respondError(w, err)
		return
	}
	entries, err := session.list(ctx, requested)
	if err != nil {
		respondError(w, err)
		return
	}
	var parent *string
	if requested != root.Path {
		p := path.Dir(requested)
		parent = &p
	}
	tosapp.WriteJSON(w, 200, Directory{Directory: directory, ParentPath: parent, Entries: entries})
}

// TOS shared paths use /VolumeN/<share>. System folders and the aggregate homes
// root are not browse roots; user home subdirectories returned by TOS are valid.
func safePath(value string) bool {
	if len(value) > 4096 || !utf8.ValidString(value) || !strings.HasPrefix(value, "/") || path.Clean(value) != value || strings.Contains(value, "\\") || strings.ContainsFunc(value, unicode.IsControl) {
		return false
	}
	parts := strings.Split(value[1:], "/")
	if len(parts) < 2 || !strings.HasPrefix(parts[0], "Volume") {
		return false
	}
	volume := strings.TrimPrefix(parts[0], "Volume")
	if volume == "" || strings.Trim(volume, "0123456789") != "" {
		return false
	}
	for _, part := range parts[1:] {
		if part == "" || strings.HasPrefix(part, "@") || strings.EqualFold(part, "#recycle") {
			return false
		}
	}
	return !(len(parts) == 2 && strings.EqualFold(parts[1], "homes"))
}
func inside(root, value string) bool { return root == value || strings.HasPrefix(value, root+"/") }
func containingRoot(roots []Entry, value string) *Entry {
	var found *Entry
	for i := range roots {
		if inside(roots[i].Path, value) && (found == nil || len(roots[i].Path) > len(found.Path)) {
			found = &roots[i]
		}
	}
	return found
}

type serviceError struct {
	status        int
	code, message string
}

func (e *serviceError) Error() string { return e.message }

var (
	invalidPath         = &serviceError{400, "FILE_INVALID_PATH", "Invalid file path or query"}
	accessDenied        = &serviceError{409, "FILE_ACCESS_DENIED", "The current user cannot access this file or directory"}
	missingLeaf         = &serviceError{404, "FILE_NOT_FOUND", "File does not exist"}
	missingDirectory    = &serviceError{404, "FILE_DIRECTORY_NOT_FOUND", "Directory does not exist"}
	notFound            = &serviceError{404, "NOT_FOUND", "File service route not found"}
	methodDenied        = &serviceError{405, "METHOD_NOT_ALLOWED", "Only GET and OPTIONS are supported"}
	originDenied        = &serviceError{403, "ORIGIN_MISMATCH", "Request origin is not allowed"}
	upstreamInvalid     = &serviceError{502, "FILE_UPSTREAM_INVALID", "TOS file service returned invalid data"}
	upstreamUnavailable = &serviceError{503, "FILE_UPSTREAM_UNAVAILABLE", "TOS file service is unavailable"}
	expired             = &serviceError{401, "TOS_SESSION_EXPIRED", "TOS session has expired"}
	tooMany             = &serviceError{413, "FILE_TOO_MANY_ENTRIES", "Directory exceeds the configured entry limit"}
	changed             = &serviceError{409, "FILE_DIRECTORY_CHANGED", "Directory changed during listing; refresh and retry"}
)

func respondError(w http.ResponseWriter, err error) {
	var failure *serviceError
	switch {
	case errors.Is(err, tosapp.ErrInvalidCredentials):
		failure = &serviceError{401, "AUTH_HEADERS_INVALID", "TOS session or CSRF credentials are invalid"}
	case errors.Is(err, tosapp.ErrOriginMismatch):
		failure = originDenied
	case errors.Is(err, context.DeadlineExceeded):
		failure = &serviceError{504, "FILE_TIMEOUT", "File service request timed out"}
	case errors.Is(err, context.Canceled):
		failure = &serviceError{408, "FILE_CANCELLED", "File service request was cancelled"}
	case errors.As(err, &failure):
	default:
		failure = upstreamUnavailable
	}
	tosapp.WriteJSON(w, failure.status, map[string]string{"code": failure.code, "error": failure.message})
}
