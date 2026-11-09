package site

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"regexp"
	"strings"
)

// CodeSet is a project's published code: a few excerpts of its real source at
// one commit (owner-approved 2026-11-09 for every project, private ones too;
// the rest of each repository stays private). code/<slug>.json holds it, and
// `go run ./cmd/code` fills Text, Lines and Sum from the repository.
type CodeSet struct {
	Slug     string    `json:"slug"`
	Repo     string    `json:"repo"` // directory under $DEV_ROOT
	Ref      string    `json:"ref"`  // the demo's pinned commit when it has one
	Excerpts []Excerpt `json:"excerpts"`
	Sum      string    `json:"sum"`
}

// Excerpt is one whole function or block of a file.
type Excerpt struct {
	Path  string `json:"path"`
	From  int    `json:"from"` // 1-based, inclusive
	To    int    `json:"to"`
	Title string `json:"title"`
	Why   string `json:"why"`
	// Calls are the demo calls every one of which runs this code: a method, or a
	// method and params it needs ("render sampling=nee"), so the page's "ran" is true.
	Calls []string `json:"calls"`
	Text  []string `json:"text"`
	Lines []string `json:"lines"` // Text highlighted: escaped HTML with token classes only
}

// Digest is what cmd/code made: a hand edit of a range or a line without a
// refill no longer matches Sum.
func (c CodeSet) Digest() string {
	c.Sum = ""
	b, _ := json.Marshal(c)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// Short is the commit as the page names it.
func (c CodeSet) Short() string { return c.Ref[:7] }

// HTML is one highlighted line, built by cmd/code from escaped text.
func (e Excerpt) HTML(i int) template.HTML { return template.HTML(e.Lines[i]) } //nolint:gosec // escaped by cmd/code; checkCode re-verifies

// CallLabels are Calls as the caption reads them: "render sampling=nee",
// and an empty value as "with no": "plan with no exclude".
func (e Excerpt) CallLabels() []string {
	var out []string
	for _, c := range e.Calls {
		f := strings.Fields(c)
		for i, kv := range f[1:] {
			if k, v, _ := strings.Cut(kv, "="); v == "" {
				f[i+1] = "with no " + k
			}
		}
		out = append(out, strings.Join(f, " "))
	}
	return out
}

// CallList is Calls as one attribute value.
func (e Excerpt) CallList() string { return strings.Join(e.Calls, "|") }

var (
	unpublishable = regexp.MustCompile(`(?i)jouett|[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}|-----BEGIN|\b(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}`)
	callSpec      = regexp.MustCompile(`^[A-Za-z_][\w.]*( [A-Za-z_]\w*=[^\s|=]*)*$`)
	codeTag       = regexp.MustCompile(`^(?:[^<]|<span class="t[ckstnfa]">[^<]*</span>)*$`)
)

// Unpublishable names what in s must never ship (the owner's surname or old
// handle, an email address, a key or a literal credential), or "".
func Unpublishable(s string) string {
	if m := unpublishable.FindString(s); m != "" {
		return fmt.Sprintf("must not publish %q", m)
	}
	return ""
}

// LockRefs maps each pinned demo to its commit.
func LockRefs(src fs.FS) (map[string]string, error) {
	b, err := fs.ReadFile(src, "demos.lock.json")
	if err != nil {
		return nil, err
	}
	var lock struct {
		Demos []struct{ Slug, Ref string } `json:"demos"`
	}
	if err := json.Unmarshal(b, &lock); err != nil {
		return nil, fmt.Errorf("demos.lock.json: %w", err)
	}
	refs := map[string]string{}
	for _, d := range lock.Demos {
		refs[d.Slug] = d.Ref
	}
	return refs, nil
}

// loadCode reads every project's code and fails on one that is missing, stale,
// not at its demo's commit, or carries anything unpublishable.
func loadCode(src fs.FS, projects []Project) (map[string]*CodeSet, error) {
	refs, err := LockRefs(src)
	if err != nil {
		return nil, err
	}
	sets := map[string]*CodeSet{}
	for _, p := range projects {
		b, err := fs.ReadFile(src, "code/"+p.Slug+".json")
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("%s: no code/%s.json: pick its excerpts and run `go run ./cmd/code %s`", p.Slug, p.Slug, p.Slug)
		}
		if err != nil {
			return nil, err
		}
		var c CodeSet
		if err := json.Unmarshal(b, &c); err != nil {
			return nil, fmt.Errorf("code/%s.json: %w", p.Slug, err)
		}
		if err := c.check(p, refs[p.Slug]); err != nil {
			return nil, fmt.Errorf("code/%s.json: %w", p.Slug, err)
		}
		sets[p.Slug] = &c
	}
	return sets, nil
}

func (c CodeSet) check(p Project, lockRef string) error {
	stale := fmt.Sprintf("run `go run ./cmd/code %s`", p.Slug)
	switch {
	case c.Slug != p.Slug:
		return fmt.Errorf("slug %q", c.Slug)
	case len(c.Ref) != 40:
		return errors.New("ref is not a full commit")
	case lockRef != "" && c.Ref != lockRef:
		return fmt.Errorf("excerpts are from %s but the demo runs %s: %s", c.Ref[:7], lockRef[:7], stale)
	case len(c.Excerpts) == 0 || len(c.Excerpts) > 3:
		return fmt.Errorf("%d excerpts, want 1 to 3", len(c.Excerpts))
	case c.Sum != c.Digest():
		return errors.New("changed since it was filled: " + stale)
	}
	n, calls := 0, 0
	for _, e := range c.Excerpts {
		n += len(e.Text)
		calls += len(e.Calls)
		if len(e.Text) != e.To-e.From+1 || len(e.Lines) != len(e.Text) {
			return fmt.Errorf("%s: not filled: %s", e.Path, stale)
		}
		if e.Title == "" || len(e.Title) > 40 || e.Why == "" || len(e.Why) > 160 {
			return fmt.Errorf("%s: title (1-40 chars) and why (1-160) are required", e.Path)
		}
		if bad := Unpublishable(strings.Join(e.Text, "\n") + e.Title + e.Why); bad != "" {
			return fmt.Errorf("%s: %s", e.Path, bad)
		}
		for _, c := range e.Calls {
			if !callSpec.MatchString(c) {
				return fmt.Errorf("%s: call %q is not `method [param=value ...]`", e.Path, c)
			}
		}
		for i, l := range e.Lines {
			if !codeTag.MatchString(l) {
				return fmt.Errorf("%s line %d: markup other than token spans", e.Path, e.From+i)
			}
		}
	}
	if n > 70 {
		return fmt.Errorf("%d lines; keep a project's excerpts to 70", n)
	}
	if p.Live() && calls == 0 {
		return errors.New("no excerpt names a demo call that runs it")
	}
	return nil
}
