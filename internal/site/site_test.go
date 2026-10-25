package site

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const goodProject = `---
title: demo
tagline: A test project.
lang: Go
tags: a, b
repo: https://github.com/crowbett/demo
demo: planned
order: 2
metric: 5 ops/s
metric_source: bench.md
---
Body with **bold**.
`

func TestParseProject(t *testing.T) {
	p, err := parseProject("demo", []byte(goodProject))
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "demo" || p.Order != 2 || len(p.Tags) != 2 || p.Private() || p.Live() {
		t.Fatalf("parsed wrong: %+v", p)
	}
	if !strings.Contains(string(p.Body), "<strong>bold</strong>") {
		t.Fatalf("body not rendered: %s", p.Body)
	}
}

func TestParseProjectRejects(t *testing.T) {
	cases := map[string]string{
		"metric without source": strings.Replace(goodProject, "metric_source: bench.md\n", "", 1),
		"bad demo state":        strings.Replace(goodProject, "demo: planned", "demo: soon", 1),
		"unknown key":           strings.Replace(goodProject, "order: 2", "order: 2\ncolour: red", 1),
		"non-github repo":       strings.Replace(goodProject, "https://github.com/crowbett/demo", "https://example.com/x", 1),
		"no front matter":       "just text",
		"unterminated":          "---\ntitle: x\n",
		"missing tagline":       strings.Replace(goodProject, "tagline: A test project.\n", "", 1),
	}
	for name, src := range cases {
		if _, err := parseProject("x", []byte(src)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func testFS(project string) fstest.MapFS {
	return fstest.MapFS{
		"content/projects/demo.md": {Data: []byte(project)},
		"demos.lock.json":          {Data: []byte(`{"demos":[{"slug":"demo","bytes":4194304,"gzip_bytes":1244160}]}`)},
		"templates/all.html": {Data: []byte(`
{{define "home"}}<html lang="en"><title>t</title><meta name="description"><meta name="viewport">{{range .Projects}}<a href="/projects/{{.Slug}}/">x</a>{{end}}{{end}}
{{define "project"}}<html lang="en"><title>t</title><meta name="description"><meta name="viewport">{{if .Project.Live}}{{demoKB .Project.Slug}}KB {{demoBytes .Project.Slug}}B{{end}}<a href="/">home</a>{{end}}
{{define "notfound"}}<html lang="en"><title>t</title><meta name="description"><meta name="viewport">{{end}}`)},
		"web/assets/site.css":  {Data: []byte("body{}")},
		"web/demos/demo/ui.js": {Data: []byte("export function mount(){}")},
		"web/.hidden":          {Data: []byte("skip me")},
	}
}

func TestBuildAndCheck(t *testing.T) {
	out := t.TempDir()
	src := testFS(strings.Replace(goodProject, "demo: planned", "demo: live", 1))
	if err := Build(Config{Src: src, Out: out, Owner: DefaultOwner, Now: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := Check(out); err != nil {
		t.Fatal(err)
	}
	page, err := os.ReadFile(filepath.Join(out, "projects", "demo", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(page), "1,215KB 4194304B") {
		t.Errorf("demo size not rendered: %s", page)
	}
	for _, f := range []string{"404.html", ".nojekyll", "sitemap.xml", "robots.txt", "assets/site.css"} {
		if _, err := os.Stat(filepath.Join(out, f)); err != nil {
			t.Errorf("missing %s", f)
		}
	}
	if _, err := os.Stat(filepath.Join(out, ".hidden")); err == nil {
		t.Error("dotfile copied from web/")
	}
}

func TestBuildRejectsLiveDemoWithoutBinary(t *testing.T) {
	src := testFS(strings.Replace(goodProject, "demo: planned", "demo: live", 1))
	src["demos.lock.json"] = &fstest.MapFile{Data: []byte(`{"demos":[]}`)}
	err := Build(Config{Src: src, Out: t.TempDir(), Owner: DefaultOwner, Now: time.Now()})
	if err == nil || !strings.Contains(err.Error(), "no built binary") {
		t.Fatalf("want missing-binary error, got %v", err)
	}
}

func TestCheckFindsProblems(t *testing.T) {
	out := t.TempDir()
	write := func(name, s string) {
		if err := writeFile(filepath.Join(out, name), []byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", `<html lang="en"><title>t</title><meta name="viewport"><a href="/missing/">x</a><a href="https://example.com/">ok</a>`)
	write("big.css", strings.Repeat("a", Budgets.CSS+1))
	write("big.woff2", strings.Repeat("a", Budgets.Fonts+1))
	err := Check(out)
	if err == nil {
		t.Fatal("check passed a broken site")
	}
	for _, want := range []string{"broken link /missing/", `missing name="description"`, "CSS totals", "fonts total"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("check did not report %q:\n%v", want, err)
		}
	}
}

func TestParseProjectCRLF(t *testing.T) {
	p, err := parseProject("demo", []byte(strings.ReplaceAll(goodProject, "\n", "\r\n")))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(p.Body), "---") || !strings.HasPrefix(string(p.Body), "<p>Body") {
		t.Fatalf("CRLF front matter leaked into the body: %q", p.Body)
	}
}

func TestBindNumbers(t *testing.T) {
	got := string(bindNumbers(`10,000 seeds gate multi-Raft & "x"`))
	want := "10,000 seeds gate <span class=\"nw\">multi-Raft</span> &amp; &#34;x&#34;"
	if got != want {
		t.Errorf("bindNumbers = %q, want %q", got, want)
	}
}

func TestBuildRejectsHeroTraceWithoutLiveDemo(t *testing.T) {
	src := testFS(goodProject)
	src["data/hero-trace.json"] = &fstest.MapFile{Data: []byte(`{"slug":"demo","params":{"rate":50},"result":{"bucketUs":500000,"emissionUs":20000,"offered":[30],"series":[{"algo":"gcra","allowed":[25],"denied":[5]}]}}`)}
	err := Build(Config{Src: src, Out: t.TempDir(), Owner: DefaultOwner, Now: time.Now()})
	if err == nil || !strings.Contains(err.Error(), "no live demo") {
		t.Fatalf("want no-live-demo error, got %v", err)
	}
}
