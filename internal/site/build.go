package site

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Owner is the identity shown on the site. Keep it to what the owner approved
// for publication (2026-10-24: first name and email only).
type Owner struct {
	Name  string
	Role  string
	Email string
	URL   string // canonical origin, no trailing slash
}

// DefaultOwner is the published identity.
var DefaultOwner = Owner{
	Name:  "Corbett",
	Role:  "Software engineer (Go, Rust, C++)",
	Email: "corbettjouett00@gmail.com",
	URL:   "https://crowbett.github.io",
}

// Config drives one build.
type Config struct {
	Src   fs.FS  // repository root: content/, templates/, web/
	Out   string // output directory; replaced wholesale
	Owner Owner
	Now   time.Time
	// Recording skips the staleness checks of images and clips: cmd/reel
	// builds the pages it records from before their clips exist.
	Recording bool
}

type pageData struct {
	Owner     Owner
	Title     string
	Path      string // site-absolute, e.g. "/" or "/projects/quorum/"
	Projects  []Project
	Project   *Project
	Year      int
	LiveCount int
	Groups    []groupView
	Prev      *Project
	Next      *Project
	Canonical string
	Stage     *Stage
	Arena     bool    // home: the netcode demo is live, so the arena can run it
	Levels    *levels // the numbers page: every live demo's binary, by language
	LiveCap   int     // the live wall: most demos running at once
}

// WallCap is the most demos the live wall runs at once on a laptop; wall.js
// halves it on phones and tablets. With the main thread throttled 4×, 4 tiles
// held 60 fps and 5 did not (measured 2026-11-09, headless Chrome).
const WallCap = 4

// pagerLink is one previous / next card at the foot of a project page.
type pagerLink struct {
	Rel, Label string
	P          *Project
}

type groupView struct {
	Group
	Projects []Project
}

// prepared is everything a render needs: parsed templates and the data shared by every page.
type prepared struct {
	tmpl     *template.Template
	base     pageData
	projects []Project
}

func prepare(cfg Config) (*prepared, error) {
	projects, err := LoadProjects(cfg.Src)
	if err != nil {
		return nil, err
	}
	sizes, err := demoSizes(cfg.Src)
	if err != nil {
		return nil, err
	}
	for _, p := range projects {
		if !p.Live() {
			continue
		}
		if _, ok := sizes[p.Slug]; !ok {
			return nil, fmt.Errorf("%s: demo is live but demos.lock.json has no built binary for it", p.Slug)
		}
		if _, err := fs.Stat(cfg.Src, "web/demos/"+p.Slug+"/ui.js"); err != nil {
			return nil, fmt.Errorf("%s: demo is live but web/demos/%s/ui.js is missing", p.Slug, p.Slug)
		}
	}
	code, err := loadCode(cfg.Src, projects)
	if err != nil {
		return nil, err
	}
	for i := range projects {
		projects[i].Code = code[projects[i].Slug]
	}
	var stage *Stage
	if slices.ContainsFunc(projects, func(p Project) bool { return p.Slug == HomeStage.Slug && p.Live() }) {
		stage = &HomeStage
	}
	var listed []Project
	trees := map[string]*binTree{}
	tmpl, err := template.New("").Funcs(template.FuncMap{
		"bytesOf": func(slug string) *binTree { return trees[slug] },
		"rank": func(slug string) string {
			return fmt.Sprintf("%02d", slices.IndexFunc(listed, func(p Project) bool { return p.Slug == slug })+1)
		},
		"reelWide": func() string { return ReelWide },
		"focus": func(slug string) string {
			if f := Showcases[slug].WideFocus; f != "" {
				return f
			}
			return Showcases[slug].Focus
		},
		"langs":     func() []string { return languages(listed) },
		"demoAsset": func(slug string) string { return "/demos/" + slug + "/ui.js" },
		"demoKB":    func(slug string) string { return thousands((sizes[slug].Gzip + 1023) / 1024) },
		"demoBytes": func(slug string) int { return sizes[slug].Raw },
		"demo":      func(slug string) demoSize { return sizes[slug] },
		"demoTour": func(slug string) string {
			if _, err := fs.Stat(cfg.Src, "web/demos/"+slug+"/tour.js"); err != nil {
				return ""
			}
			return "/demos/" + slug + "/tour.js"
		},
		"tourShares": func(slug string) bool {
			b, err := fs.ReadFile(cfg.Src, "web/demos/"+slug+"/tour.js")
			return err == nil && bytes.Contains(b, []byte("export const share"))
		},
		"bind":    bindNumbers,
		"figures": figures,
		"pg": func(rel, label string, p *Project) pagerLink {
			return pagerLink{Rel: rel, Label: label, P: p}
		},
		"num": thousands,
		"add": func(a, b int) int { return a + b },
		"sub": func(a, b int) int { return a - b },
		"search": func(p Project) string {
			return strings.ToLower(strings.Join(append([]string{p.Slug, p.Title, p.Tagline, p.Lang}, p.Tags...), " "))
		},
	}).ParseFS(cfg.Src, "templates/*.html")
	if err != nil {
		return nil, fmt.Errorf("templates: %w", err)
	}
	// Home lists projects by group, live demos first within each, then by
	// order; every page that numbers or walks the projects uses this order.
	base := pageData{Owner: cfg.Owner, Year: cfg.Now.Year(), Stage: stage, LiveCap: WallCap}
	base.Arena = slices.ContainsFunc(projects, func(p Project) bool { return p.Slug == "netcode" && p.Live() })
	for _, g := range Groups {
		gv := groupView{Group: g}
		for _, live := range []bool{true, false} {
			for _, p := range projects {
				if p.Group == g.Key && p.Live() == live {
					gv.Projects = append(gv.Projects, p)
				}
			}
		}
		if len(gv.Projects) > 0 {
			base.Groups = append(base.Groups, gv)
			listed = append(listed, gv.Projects...)
		}
	}
	base.Projects = listed
	var bins []binLevel
	var kinds []string
	for _, p := range listed {
		if !p.Live() {
			continue
		}
		base.LiveCount++
		d := sizes[p.Slug]
		t, err := loadTree(cfg.Src, p.Slug, d)
		if err != nil {
			return nil, err
		}
		bins = append(bins, binLevel{Slug: p.Slug, Title: p.Title, Built: d.Built, Bytes: d.Raw, Funcs: t.Root.F, Gzip: d.Gzip})
		kinds = append(kinds, t.Kind)
		trees[p.Slug] = treeTop(t, bins[len(bins)-1])
	}
	if len(bins) > 0 {
		base.Levels = buildLevels(bins, kinds)
	}
	return &prepared{tmpl: tmpl, base: base, projects: projects}, nil
}

// Build renders the site into cfg.Out.
func Build(cfg Config) error {
	s, err := prepare(cfg)
	if err != nil {
		return err
	}
	if !cfg.Recording {
		if err := checkShareCards(cfg, s); err != nil {
			return err
		}
		if err := checkMasks(cfg, s); err != nil {
			return err
		}
		if s.base.Stage != nil {
			if err := checkStage(cfg); err != nil {
				return err
			}
		}
		if err := checkReel(cfg); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(cfg.Out); err != nil {
		return err
	}
	tmpl, base, projects := s.tmpl, s.base, s.projects
	render := func(name, urlPath, title string, p *Project) error {
		d := base
		d.Title, d.Path, d.Project = title, urlPath, p
		if i := slices.IndexFunc(base.Projects, func(q Project) bool { return p != nil && q.Slug == p.Slug }); i >= 0 {
			n := len(base.Projects)
			d.Prev, d.Next = &base.Projects[(i+n-1)%n], &base.Projects[(i+1)%n]
		}
		d.Canonical = cfg.Owner.URL + urlPath
		var b bytes.Buffer
		if err := tmpl.ExecuteTemplate(&b, name, d); err != nil {
			return fmt.Errorf("render %s: %w", urlPath, err)
		}
		file := filepath.Join(cfg.Out, filepath.FromSlash(strings.TrimPrefix(urlPath, "/")))
		if strings.HasSuffix(urlPath, "/") {
			file = filepath.Join(file, "index.html")
		}
		return writeFile(file, b.Bytes())
	}
	if err := render("home", "/", "", nil); err != nil {
		return err
	}
	for i := range projects {
		p := &projects[i]
		if err := render("project", "/projects/"+p.Slug+"/", p.Title, p); err != nil {
			return err
		}
	}
	if err := render("numbers", "/numbers/", "Numbers", nil); err != nil {
		return err
	}
	if base.LiveCount > 0 {
		if err := render("live", "/live/", "Live", nil); err != nil {
			return err
		}
	}
	if err := render("notfound", "/404.html", "Not found", nil); err != nil {
		return err
	}
	if err := writeSearch(filepath.Join(cfg.Out, "search.json"), base.Projects); err != nil {
		return err
	}
	if err := writeFind(filepath.Join(cfg.Out, "find.json"), base.Projects); err != nil {
		return err
	}
	if err := writePeek(cfg.Out, base.Projects); err != nil {
		return err
	}
	if err := copyTree(cfg.Src, "web", cfg.Out); err != nil {
		return err
	}
	if err := writeFile(filepath.Join(cfg.Out, ".nojekyll"), nil); err != nil {
		return err
	}
	return writeSitemap(cfg, projects, base.LiveCount > 0)
}

// writeSearch writes the command palette's index (web/assets/palette.js): every
// project in home order.
func writeSearch(file string, projects []Project) error {
	type entry struct {
		Slug    string   `json:"slug"`
		Title   string   `json:"title"`
		Tagline string   `json:"tagline"`
		Lang    string   `json:"lang"`
		Tags    []string `json:"tags"`
		Group   string   `json:"group"`
		Live    bool     `json:"live"`
		N       int      `json:"n"`
		Href    string   `json:"href"`
		Try     []string `json:"try,omitempty"`
	}
	out := make([]entry, len(projects))
	for i, p := range projects {
		href := "/projects/" + p.Slug + "/"
		if p.Live() {
			href += "#demo"
		}
		out[i] = entry{p.Slug, p.Title, p.Tagline, p.Lang, p.Tags, p.Kind().Name, p.Live(), i + 1, href, ShellTries[p.Slug]}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return err
	}
	return writeFile(file, b)
}

// demoSize is what the lock records of one built binary.
type demoSize struct {
	Raw, Gzip int
	Built     string // toolchain, e.g. "Go 1.27.3"
	SHA       string // first 8 hex of the binary's sha256
	Full      string // the whole sha256
	Ref       string // the pinned commit, short
}

var version = regexp.MustCompile(`\d+\.\d+(\.\d+)?`)

var (
	numberSpace = regexp.MustCompile(`(\d) `)
	hyphenWord  = regexp.MustCompile(`[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+`)
)

// figure finds a number; figures marks it unless it is part of a word or an
// entity ("p99", "BM25", "3DBenchy", "&#39;"). An x between numbers or after
// one ("400x225", "2.33x") is a times sign, not a letter.
var figure = regexp.MustCompile(`\d[\d,.]*\d|\d`)

func figures(s string) template.HTML {
	h := string(bindNumbers(s))
	letter := func(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' }
	digit := func(c byte) bool { return c >= '0' && c <= '9' }
	var b strings.Builder
	last := 0
	for _, m := range figure.FindAllStringIndex(h, -1) {
		i, j := m[0], m[1]
		if i > 0 {
			c := h[i-1]
			if c == '#' || c == '&' || letter(c) && !(c == 'x' && i > 1 && digit(h[i-2])) {
				continue
			}
		}
		if j < len(h) && letter(h[j]) && !(h[j] == 'x' && (j+1 == len(h) || !letter(h[j+1]))) {
			continue
		}
		b.WriteString(h[last:i])
		b.WriteString("<b>" + h[i:j] + "</b>")
		last = j
	}
	b.WriteString(h[last:])
	return template.HTML(b.String()) //nolint:gosec // bindNumbers escaped s; only digits are wrapped
}

// bindNumbers keeps a number on the same line as the word after it ("30 s",
// "6.83 ms") with a no-break space, and a hyphenated word ("multi-Raft") whole
// in a .nw span; the text is unchanged.
func bindNumbers(s string) template.HTML {
	s = template.HTMLEscapeString(numberSpace.ReplaceAllString(s, "$1\u00a0"))
	return template.HTML(hyphenWord.ReplaceAllString(s, `<span class="nw">$0</span>`))
}

// languages lists every language the projects name ("Rust, Swift" names
// two), the most used first, ties in the order they first appear.
func languages(projects []Project) []string {
	var out []string
	count := map[string]int{}
	for _, p := range projects {
		for _, l := range strings.Split(p.Lang, ", ") {
			if l = strings.TrimSpace(l); l != "" {
				if count[l] == 0 {
					out = append(out, l)
				}
				count[l]++
			}
		}
	}
	slices.SortStableFunc(out, func(a, b string) int { return count[b] - count[a] })
	return out
}

// thousands formats n with comma separators, as the site's copy writes numbers.
func thousands(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// demoSizes reads the raw and gzipped size of every built demo binary from the lock.
func demoSizes(src fs.FS) (map[string]demoSize, error) {
	b, err := fs.ReadFile(src, "demos.lock.json")
	if err != nil {
		return nil, err
	}
	var lock struct {
		Go    string `json:"go"`
		Demos []struct {
			Slug  string `json:"slug"`
			Kind  string `json:"kind"`
			Ref   string `json:"ref"`
			Rustc string `json:"rustc"`
			Clang string `json:"clang"`
			SHA   string `json:"sha256"`
			Raw   int    `json:"bytes"`
			Gzip  int    `json:"gzip_bytes"`
		} `json:"demos"`
	}
	if err := json.Unmarshal(b, &lock); err != nil {
		return nil, fmt.Errorf("demos.lock.json: %w", err)
	}
	sizes := map[string]demoSize{}
	for _, d := range lock.Demos {
		if d.Gzip == 0 {
			continue
		}
		built := "Go " + version.FindString(lock.Go)
		switch d.Kind {
		case "rust":
			built = "Rust " + version.FindString(d.Rustc)
		case "cpp":
			built = "C++, clang " + version.FindString(d.Clang)
		}
		ds := demoSize{Raw: d.Raw, Gzip: d.Gzip, Built: built, SHA: d.SHA[:min(8, len(d.SHA))], Full: d.SHA}
		if len(d.Ref) >= 7 {
			ds.Ref = d.Ref[:7]
		}
		sizes[d.Slug] = ds
	}
	return sizes, nil
}

func writeSitemap(cfg Config, projects []Project, wall bool) error {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	urls := []string{"/", "/numbers/"}
	if wall {
		urls = append(urls, "/live/")
	}
	for _, p := range projects {
		urls = append(urls, "/projects/"+p.Slug+"/")
	}
	for _, u := range urls {
		fmt.Fprintf(&b, "  <url><loc>%s%s</loc></url>\n", cfg.Owner.URL, u)
	}
	b.WriteString("</urlset>\n")
	if err := writeFile(filepath.Join(cfg.Out, "sitemap.xml"), []byte(b.String())); err != nil {
		return err
	}
	robots := "User-agent: *\nAllow: /\nSitemap: " + cfg.Owner.URL + "/sitemap.xml\n"
	return writeFile(filepath.Join(cfg.Out, "robots.txt"), []byte(robots))
}

// copyTree copies dir (in src) into out, preserving relative paths.
func copyTree(src fs.FS, dir, out string) error {
	return fs.WalkDir(src, dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasPrefix(d.Name(), ".") {
			return nil
		}
		b, err := fs.ReadFile(src, p)
		if err != nil {
			return err
		}
		return writeFile(filepath.Join(out, filepath.FromSlash(strings.TrimPrefix(p, dir+"/"))), b)
	})
}

func writeFile(name string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		return err
	}
	return os.WriteFile(name, b, 0o644)
}
