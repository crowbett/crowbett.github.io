// Package site builds the static site: project pages from content/, templates,
// assets and prebuilt demo binaries, then checks the output.
package site

import (
	"bufio"
	"bytes"
	"fmt"
	"html/template"
	"io/fs"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
)

// Project is one entry in content/projects/<slug>.md.
//
// Front matter is "key: value" lines between "---" fences. Keys:
// title, tagline, lang, tags (comma list), repo (URL; empty = private source),
// demo (live | planned | none), order (int; lower first), metric (one measured
// headline number, quoted from the repo, with its source in metric_source;
// it leads with the number or a capital so the cards read as one set),
// demo_try (one line on what a visitor can do in the live demo; live only).
type Project struct {
	Slug         string
	Title        string
	Tagline      string
	Lang         string
	Tags         []string
	Repo         string
	Demo         string
	DemoTry      string
	Order        int
	Metric       string
	MetricSource string
	Body         template.HTML
}

// Private reports whether the source is not public.
func (p Project) Private() bool { return p.Repo == "" }

// Live reports whether the project has a working in-browser demo.
func (p Project) Live() bool { return p.Demo == "live" }

var demoStates = []string{"live", "planned", "none"}

// LoadProjects parses every content/projects/*.md in fsys, sorted by Order then Slug.
func LoadProjects(fsys fs.FS) ([]Project, error) {
	files, err := fs.Glob(fsys, "content/projects/*.md")
	if err != nil {
		return nil, err
	}
	var out []Project
	for _, f := range files {
		b, err := fs.ReadFile(fsys, f)
		if err != nil {
			return nil, err
		}
		p, err := parseProject(strings.TrimSuffix(path.Base(f), ".md"), b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		out = append(out, p)
	}
	slices.SortFunc(out, func(a, b Project) int {
		if a.Order != b.Order {
			return a.Order - b.Order
		}
		return strings.Compare(a.Slug, b.Slug)
	})
	return out, nil
}

func parseProject(slug string, src []byte) (Project, error) {
	p := Project{Slug: slug}
	src = bytes.ReplaceAll(src, []byte("\r\n"), []byte("\n"))
	meta, body, err := splitFrontMatter(src)
	if err != nil {
		return p, err
	}
	for k, v := range meta {
		switch k {
		case "title":
			p.Title = v
		case "tagline":
			p.Tagline = v
		case "lang":
			p.Lang = v
		case "tags":
			for _, t := range strings.Split(v, ",") {
				if t = strings.TrimSpace(t); t != "" {
					p.Tags = append(p.Tags, t)
				}
			}
		case "repo":
			p.Repo = v
		case "demo":
			p.Demo = v
		case "demo_try":
			p.DemoTry = v
		case "order":
			if p.Order, err = strconv.Atoi(v); err != nil {
				return p, fmt.Errorf("order %q: %w", v, err)
			}
		case "metric":
			p.Metric = v
		case "metric_source":
			p.MetricSource = v
		default:
			return p, fmt.Errorf("unknown front matter key %q", k)
		}
	}
	switch {
	case p.Title == "" || p.Tagline == "":
		return p, fmt.Errorf("title and tagline are required")
	case !slices.Contains(demoStates, p.Demo):
		return p, fmt.Errorf("demo must be one of %v, got %q", demoStates, p.Demo)
	case p.Repo != "" && !strings.HasPrefix(p.Repo, "https://github.com/"):
		return p, fmt.Errorf("repo must be a https://github.com/ URL or empty")
	case p.Live() != (p.DemoTry != ""):
		return p, fmt.Errorf("demo_try is required for a live demo and only allowed on one")
	case p.Metric != "" && p.MetricSource == "":
		return p, fmt.Errorf("metric needs metric_source: every number on the site cites where it was measured")
	case p.Metric != "" && !strings.ContainsRune("0123456789~ABCDEFGHIJKLMNOPQRSTUVWXYZ", rune(p.Metric[0])):
		return p, fmt.Errorf("metric must lead with its number or a capital, got %q", p.Metric)
	}
	var html bytes.Buffer
	if err := goldmark.Convert(body, &html); err != nil {
		return p, err
	}
	p.Body = template.HTML(html.String()) //nolint:gosec // our own content files, not user input
	return p, nil
}

func splitFrontMatter(src []byte) (map[string]string, []byte, error) {
	s := bufio.NewScanner(bytes.NewReader(src))
	if !s.Scan() || strings.TrimSpace(s.Text()) != "---" {
		return nil, nil, fmt.Errorf("missing front matter")
	}
	meta := map[string]string{}
	consumed := len(s.Bytes()) + 1
	for s.Scan() {
		line := s.Text()
		consumed += len(s.Bytes()) + 1
		if strings.TrimSpace(line) == "---" {
			return meta, src[min(consumed, len(src)):], nil
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			return nil, nil, fmt.Errorf("bad front matter line %q", line)
		}
		meta[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return nil, nil, fmt.Errorf("unterminated front matter")
}
