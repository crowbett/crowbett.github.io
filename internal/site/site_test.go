package site

import (
	"fmt"
	"math/rand/v2"
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
		"lowercase metric":      strings.Replace(goodProject, "metric: 5 ops/s", "metric: saturates at 5 ops/s", 1),
		"bad demo state":        strings.Replace(goodProject, "demo: planned", "demo: soon", 1),
		"live without demo_try": strings.Replace(goodProject, "demo: planned", "demo: live", 1),
		"demo_try not live":     strings.Replace(goodProject, "demo: planned", "demo: planned\ndemo_try: Try it.", 1),
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
	src := testFS(strings.Replace(goodProject, "demo: planned", "demo: live\ndemo_try: Try it.", 1))
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
	src := testFS(strings.Replace(goodProject, "demo: planned", "demo: live\ndemo_try: Try it.", 1))
	src["demos.lock.json"] = &fstest.MapFile{Data: []byte(`{"demos":[]}`)}
	err := Build(Config{Src: src, Out: t.TempDir(), Owner: DefaultOwner, Now: time.Now()})
	if err == nil || !strings.Contains(err.Error(), "no built binary") {
		t.Fatalf("want missing-binary error, got %v", err)
	}
}

func TestCheckCountsCSSPerPage(t *testing.T) {
	out := t.TempDir()
	write := func(name string, n int) {
		if err := writeFile(filepath.Join(out, name), []byte(strings.Repeat("a", n))); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", 0)
	write("assets/site.css", Budgets.CSS/2)
	write("demos/a/ui.css", Budgets.CSS/2)
	write("demos/b/ui.css", Budgets.CSS/2)
	if err := Check(out); err != nil && strings.Contains(err.Error(), "CSS totals") {
		t.Fatalf("demo stylesheets on different pages were summed:\n%v", err)
	}
	write("demos/c/ui.css", Budgets.CSS/2+1)
	if err := Check(out); err == nil || !strings.Contains(err.Error(), "site CSS + /demos/c/ui.css") {
		t.Fatalf("want the heaviest page over budget, got %v", err)
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
	write("og/big.png", strings.Repeat("a", Budgets.ShareImage+1))
	write("demos/x/ui.css", `.x { --x-c: var(--accent); color: var(--x-c); margin: var(--sp-1); }`)
	write("demos/y/ui.css", `@keyframes y { 0% { transform: scaleY(0); } 50% { transform: scale(1, 0.0); } 90% { transform: scaleX(0.001); } } .z { scale: 1 0; } .k { scale: 0.5; }`)
	write("share.html", `<html lang="en"><title>t</title><meta name="description"><meta name="viewport"><meta property="og:image" content="https://x.test/og/missing.png">`)
	err := Check(out)
	if err == nil {
		t.Fatal("check passed a broken site")
	}
	for _, want := range []string{"broken link /missing/", `missing name="description"`, "CSS totals", "fonts total", "og/big.png", "og:image /og/missing.png does not exist", "demos/x/ui.css: reads --sp-1", "scaleY(0) scales to zero", "scale(1, 0.0) scales to zero", "scale: 1 0 scales to zero"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("check did not report %q:\n%v", want, err)
		}
	}
	if strings.Contains(err.Error(), "scaleX(0.001)") || strings.Contains(err.Error(), "scale: 0.5") {
		t.Errorf("check reported a nonzero scale:\n%v", err)
	}
	if strings.Contains(err.Error(), "--x-c") || strings.Contains(err.Error(), "--accent") {
		t.Errorf("check reported a demo's own property or a contract token:\n%v", err)
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

// The peak label is a number on the page: it must be the tallest denied
// bucket as a rate, and its line must touch that bar, in both drawings.
func TestHeroPeakIsTallestDeniedBucket(t *testing.T) {
	src := fstest.MapFS{"data/hero-trace.json": &fstest.MapFile{Data: []byte(`{"slug":"demo","params":{"rate":50,"durationMs":2000},"result":{"bucketUs":500000,"emissionUs":20000,"offered":[30,300,280,20],"series":[{"algo":"gcra","allowed":[25,25,25,20],"denied":[5,275,255,0]}]}}`)}}
	h, err := loadHeroTrace(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []*heroChart{h.Wide, h.Tall} {
		if c.Peak != 550 {
			t.Errorf("%s: peak %d/s, want 550", c.Class, c.Peak)
		}
		if top := c.Bars[1].DY; top != c.PeakY {
			t.Errorf("%s: tallest denied bar tops out at %v, peak line at %v", c.Class, top, c.PeakY)
		}
	}
}

func TestBuildRejectsStaleShareCards(t *testing.T) {
	src := testFS(goodProject)
	src["templates/og.html"] = &fstest.MapFile{Data: []byte(`{{define "og"}}{{if .Project}}{{.Project.Title}}{{else}}home{{end}}{{end}}`)}
	cfg := Config{Src: src, Out: t.TempDir(), Owner: DefaultOwner, Now: time.Now()}
	err := Build(cfg)
	if err == nil || !strings.Contains(err.Error(), "share images out of date for demo, home") {
		t.Fatalf("want stale-card error, got %v", err)
	}
	cards, err := ShareCards(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var sums strings.Builder
	for _, name := range []string{"home", "demo"} {
		sum, err := ImageSum(src, cards[name], ShareDeps)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&sums, "%s %s\n", name, sum)
	}
	src[ShareSums] = &fstest.MapFile{Data: []byte(sums.String())}
	if err := Build(cfg); err != nil {
		t.Fatal(err)
	}
	src["web/assets/site.css"] = &fstest.MapFile{Data: []byte("body{color:red}")}
	if err := Build(cfg); err == nil || !strings.Contains(err.Error(), "share images out of date") {
		t.Fatalf("want stale-card error after a site.css change, got %v", err)
	}
}

func TestCheckGzipsEachBinary(t *testing.T) {
	defer func(b int) { Budgets.WASMGzipped = b }(Budgets.WASMGzipped)
	Budgets.WASMGzipped = 1000
	out := t.TempDir()
	noise := make([]byte, 4000)
	rand.NewChaCha8([32]byte{}).Read(noise)
	for i, b := range [][]byte{noise, make([]byte, 4000), noise[:500], noise[:3000], make([]byte, 9000)} {
		if err := writeFile(filepath.Join(out, "wasm", fmt.Sprintf("d%d.wasm", i)), b); err != nil {
			t.Fatal(err)
		}
	}
	err := Check(out)
	if err == nil {
		t.Fatal("check passed binaries over the gzip budget")
	}
	for i, over := range []bool{true, false, false, true, false} {
		if got := strings.Contains(err.Error(), fmt.Sprintf("/wasm/d%d.wasm: ", i)); got != over {
			t.Errorf("d%d.wasm reported %v, want %v:\n%v", i, got, over, err)
		}
	}
}
