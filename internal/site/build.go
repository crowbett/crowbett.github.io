package site

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"os"
	"path/filepath"
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
	Role:  "Backend engineer (Go)",
	Email: "corbettjouett00@gmail.com",
	URL:   "https://crowbett.github.io",
}

// Config drives one build.
type Config struct {
	Src   fs.FS  // repository root: content/, templates/, web/
	Out   string // output directory; replaced wholesale
	Owner Owner
	Now   time.Time
}

type pageData struct {
	Owner     Owner
	Title     string
	Path      string // site-absolute, e.g. "/" or "/projects/quorum/"
	Projects  []Project
	Project   *Project
	Year      int
	LiveCount int
	Canonical string
}

// Build renders the site into cfg.Out.
func Build(cfg Config) error {
	projects, err := LoadProjects(cfg.Src)
	if err != nil {
		return err
	}
	sizes, err := demoSizes(cfg.Src)
	if err != nil {
		return err
	}
	for _, p := range projects {
		if !p.Live() {
			continue
		}
		if _, ok := sizes[p.Slug]; !ok {
			return fmt.Errorf("%s: demo is live but demos.lock.json has no built binary for it", p.Slug)
		}
		if _, err := fs.Stat(cfg.Src, "web/demos/"+p.Slug+"/ui.js"); err != nil {
			return fmt.Errorf("%s: demo is live but web/demos/%s/ui.js is missing", p.Slug, p.Slug)
		}
	}
	tmpl, err := template.New("").Funcs(template.FuncMap{
		"demoAsset": func(slug string) string { return "/demos/" + slug + "/ui.js" },
		"demoKB":    func(slug string) int { return (sizes[slug] + 1023) / 1024 },
	}).ParseFS(cfg.Src, "templates/*.html")
	if err != nil {
		return fmt.Errorf("templates: %w", err)
	}
	if err := os.RemoveAll(cfg.Out); err != nil {
		return err
	}
	base := pageData{Owner: cfg.Owner, Projects: projects, Year: cfg.Now.Year()}
	for _, p := range projects {
		if p.Live() {
			base.LiveCount++
		}
	}
	render := func(name, urlPath, title string, p *Project) error {
		d := base
		d.Title, d.Path, d.Project = title, urlPath, p
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
	if err := render("notfound", "/404.html", "Not found", nil); err != nil {
		return err
	}
	if err := copyTree(cfg.Src, "web", cfg.Out); err != nil {
		return err
	}
	if err := writeFile(filepath.Join(cfg.Out, ".nojekyll"), nil); err != nil {
		return err
	}
	return writeSitemap(cfg, projects)
}

// demoSizes reads the gzipped size of every built demo binary from the lock.
func demoSizes(src fs.FS) (map[string]int, error) {
	b, err := fs.ReadFile(src, "demos.lock.json")
	if err != nil {
		return nil, err
	}
	var lock struct {
		Demos []struct {
			Slug string `json:"slug"`
			Gzip int    `json:"gzip_bytes"`
		} `json:"demos"`
	}
	if err := json.Unmarshal(b, &lock); err != nil {
		return nil, fmt.Errorf("demos.lock.json: %w", err)
	}
	sizes := map[string]int{}
	for _, d := range lock.Demos {
		if d.Gzip > 0 {
			sizes[d.Slug] = d.Gzip
		}
	}
	return sizes, nil
}

func writeSitemap(cfg Config, projects []Project) error {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	urls := []string{"/"}
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
