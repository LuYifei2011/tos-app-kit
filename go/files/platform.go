package files

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	tosapp "github.com/LuYifei2011/tos-app-kit/go"
)

const maxResponseBytes = 8 << 20

type platformSession struct {
	handler     *Handler
	credentials tosapp.Credentials
	username    string
}

func (s *platformSession) call(ctx context.Context, endpoint string, query url.Values, out any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.handler.platformURL+"/v2/fileManage/"+endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return upstreamInvalid
	}
	req.Header.Set("Accept", "application/json")
	if err := s.credentials.Apply(req.Header); err != nil {
		return err
	}
	if s.username != "" {
		req.Header.Set("Cookie", req.Header.Get("Cookie")+"; "+s.username)
	}
	res, err := s.handler.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return upstreamUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == 401 {
		return expired
	}
	if res.StatusCode == 403 {
		return accessDenied
	}
	if res.StatusCode != 200 {
		return upstreamUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil || len(data) > maxResponseBytes {
		return upstreamInvalid
	}
	var envelope struct {
		Login  *bool           `json:"is_login"`
		Code   *bool           `json:"code"`
		Number int             `json:"code_num"`
		Data   json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.Login == nil || envelope.Code == nil {
		return upstreamInvalid
	}
	if !*envelope.Login || envelope.Number == 24 || envelope.Number == 27 || envelope.Number == 117 {
		return expired
	}
	if !*envelope.Code {
		if envelope.Number == 104 {
			return missingLeaf
		}
		return accessDenied
	}
	if envelope.Number != 0 || len(envelope.Data) == 0 || string(envelope.Data) == "null" || json.Unmarshal(envelope.Data, out) != nil {
		return upstreamInvalid
	}
	return nil
}

type platformEntry struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	Type     string      `json:"f_type"`
	RealType string      `json:"f_real_type"`
	Size     json.Number `json:"size"`
	Modified json.Number `json:"m_time_stamp"`
}

func (p platformEntry) link() bool {
	return strings.Contains(strings.ToLower(p.Type+" "+p.RealType), "link")
}
func (p platformEntry) entry() (*Entry, error) {
	if p.link() {
		return nil, accessDenied
	}
	if !safePath(p.Path) || p.Name == "" || p.Name != path.Base(p.Path) || p.Type == "" {
		return nil, upstreamInvalid
	}
	kind := "file"
	if p.Type == "folder" {
		kind = "directory"
	}
	entry := &Entry{Path: p.Path, Name: p.Name, Kind: kind}
	if p.Size != "" {
		value, err := p.Size.Int64()
		// JSON numbers above this bound cannot be represented exactly in JS.
		if err != nil || value < 0 || value > 9007199254740991 {
			return nil, upstreamInvalid
		}
		entry.Size = &value
	}
	if p.Modified != "" {
		value, err := p.Modified.Int64()
		if err != nil || value < 0 || value > 253402300799 {
			return nil, upstreamInvalid
		}
		entry.ModifiedAt = time.Unix(value, 0).UTC().Format(time.RFC3339)
	}
	return entry, nil
}
func (s *platformSession) shares(ctx context.Context) ([]Entry, error) {
	var items []platformEntry
	if err := s.call(ctx, "homeList", nil, &items); err != nil {
		return nil, err
	}
	if len(items) > s.handler.maxEntries {
		return nil, tooMany
	}
	roots := []Entry{}
	seen := map[string]bool{}
	for _, item := range items {
		if item.Type != "folder" || item.link() || !safePath(item.Path) || seen[item.Path] {
			continue
		}
		// homeList can expose a display name distinct from the path's final component.
		name := item.Name
		item.Name = path.Base(item.Path)
		entry, err := item.entry()
		if err != nil {
			return nil, err
		}
		if name != "" {
			entry.Name = name
		}
		roots = append(roots, *entry)
		seen[item.Path] = true
	}
	sortEntries(roots)
	return roots, nil
}
func (s *platformSession) roots(ctx context.Context, shares []Entry) ([]Entry, error) {
	if s.handler.allowed == nil {
		return shares, nil
	}
	roots := []Entry{}
	for _, allowed := range s.handler.allowed {
		// If an allowed directory contains several shares, expose only those shares.
		candidates := []string{}
		if containingRoot(shares, allowed) != nil {
			candidates = append(candidates, allowed)
		}
		for _, share := range shares {
			if inside(allowed, share.Path) {
				candidates = append(candidates, share.Path)
			}
		}
		for _, candidate := range candidates {
			duplicate := false
			for _, root := range roots {
				if root.Path == candidate {
					duplicate = true
					break
				}
			}
			if duplicate {
				continue
			}
			root, err := s.directory(ctx, shares, candidate)
			if errors.Is(err, accessDenied) || errors.Is(err, missingDirectory) {
				continue
			}
			if err != nil {
				return nil, err
			}
			roots = append(roots, *root)
		}
	}
	sortEntries(roots)
	return roots, nil
}
func (s *platformSession) info(ctx context.Context, requested string) (*Entry, error) {
	var item platformEntry
	if err := s.call(ctx, "folderInfoAll", url.Values{"path": {requested}}, &item); err != nil {
		return nil, err
	}
	if item.Path != requested {
		return nil, upstreamInvalid
	}
	return item.entry()
}
func (s *platformSession) directory(ctx context.Context, shares []Entry, requested string) (*Entry, error) {
	share := containingRoot(shares, requested)
	if share == nil {
		return nil, accessDenied
	}
	paths := []string{share.Path}
	current := share.Path
	for _, part := range strings.Split(strings.TrimPrefix(requested, share.Path), "/") {
		if part == "" {
			continue
		}
		current += "/" + part
		paths = append(paths, current)
	}
	var result *Entry
	for _, current := range paths {
		var err error
		result, err = s.info(ctx, current)
		if errors.Is(err, missingLeaf) {
			return nil, missingDirectory
		}
		if err != nil {
			return nil, err
		}
		if result.Kind != "directory" {
			return nil, accessDenied
		}
	}
	return result, nil
}
func (s *platformSession) list(ctx context.Context, requested string) ([]Entry, error) {
	result := []Entry{}
	seen := map[string]bool{}
	total := -1
	for page := 1; page <= s.handler.maxEntries+1; page++ {
		var data struct {
			Total   *int            `json:"total"`
			Entries []platformEntry `json:"data"`
		}
		query := url.Values{"path": {requested}, "limit": {"1000"}, "order": {"false"}, "page": {strconv.Itoa(page)}}
		if err := s.call(ctx, "list", query, &data); err != nil {
			return nil, err
		}
		if data.Total == nil || *data.Total < 0 || data.Entries == nil || len(seen)+len(data.Entries) > *data.Total {
			return nil, upstreamInvalid
		}
		if *data.Total > s.handler.maxEntries {
			return nil, tooMany
		}
		if total < 0 {
			total = *data.Total
		} else if total != *data.Total {
			return nil, changed
		}
		for _, item := range data.Entries {
			if item.Name == "" || item.Name == "." || item.Name == ".." || strings.ContainsAny(item.Name, "/\\") || item.Path != path.Join(requested, item.Name) {
				return nil, upstreamInvalid
			}
			if seen[item.Name] {
				return nil, changed
			}
			seen[item.Name] = true
			// Links and system entries are never offered as save/open targets.
			if item.link() || !safePath(item.Path) {
				continue
			}
			entry, err := item.entry()
			if err != nil {
				return nil, err
			}
			result = append(result, *entry)
		}
		if len(seen) == total {
			sortEntries(result)
			return result, nil
		}
		if len(data.Entries) == 0 {
			return nil, changed
		}
	}
	return nil, changed
}
func sortEntries(entries []Entry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == "directory"
		}
		return entries[i].Name < entries[j].Name
	})
}
