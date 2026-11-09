package site

import (
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
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
group: tools
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
		"unknown group":         strings.Replace(goodProject, "group: tools", "group: misc", 1),
		"missing group":         strings.Replace(goodProject, "group: tools\n", "", 1),
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

// withClip gives the fixture's live demo a showcase and a reel clip recorded
// from its current sources, as cmd/reel would.
func withClip(t *testing.T, src fstest.MapFS) {
	t.Helper()
	Showcases["demo"] = Showcase{Seconds: 1}
	t.Cleanup(func() { delete(Showcases, "demo") })
	src["web/reel/demo.mp4"] = &fstest.MapFile{Data: []byte("mp4")}
	src["web/reel/demo.webp"] = &fstest.MapFile{Data: []byte("webp")}
	src["web/reel/demo-n.mp4"] = &fstest.MapFile{Data: []byte("mp4")}
	src["web/reel/demo-n.webp"] = &fstest.MapFile{Data: []byte("webp")}
	items, err := ReelSources(src)
	if err != nil {
		t.Fatal(err)
	}
	sum, err := ImageSum(src, items["demo"], nil)
	if err != nil {
		t.Fatal(err)
	}
	src[ReelSums] = &fstest.MapFile{Data: []byte("demo " + sum + "\n")}
	saved := HomeStage
	HomeStage.Slug = "demo"
	t.Cleanup(func() { HomeStage = saved })
	src[StagePoster] = &fstest.MapFile{Data: []byte("webp")}
	item, err := StageSource(src)
	if err != nil {
		t.Fatal(err)
	}
	if sum, err = ImageSum(src, item, nil); err != nil {
		t.Fatal(err)
	}
	src[StageSums] = &fstest.MapFile{Data: []byte("stage " + sum + "\n")}
}

func TestBuildAndCheck(t *testing.T) {
	out := t.TempDir()
	src := testFS(strings.Replace(goodProject, "demo: planned", "demo: live\ndemo_try: Try it.", 1))
	withClip(t, src)
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
	write := func(name, s string) {
		if err := writeFile(filepath.Join(out, name), []byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	page := func(sheets ...string) string {
		var b strings.Builder
		for _, s := range sheets {
			fmt.Fprintf(&b, `<link rel="stylesheet" href="%s">`, s)
		}
		return b.String()
	}
	half := strings.Repeat("a", Budgets.CSS/2)
	write("assets/site.css", half)
	write("assets/home.css", half)
	write("assets/project.css", strings.Repeat("a", Budgets.CSS/4))
	write("demos/a/ui.css", strings.Repeat("a", Budgets.CSS/4))
	write("demos/b/ui.css", strings.Repeat("a", Budgets.CSS/4+1))
	write("index.html", page("/assets/site.css", "/assets/home.css"))
	write("a/index.html", page("/assets/site.css", "/assets/project.css")+`<section data-ui="/demos/a/ui.js">`)
	if err := Check(out); err != nil && strings.Contains(err.Error(), "CSS totals") {
		t.Fatalf("stylesheets on different pages were summed:\n%v", err)
	}
	write("b/index.html", page("/assets/site.css", "/assets/project.css")+`<section data-ui="/demos/b/ui.js">`)
	err := Check(out)
	if err == nil || !strings.Contains(err.Error(), "/b/index.html: CSS totals") || !strings.Contains(err.Error(), "/demos/b/ui.css") {
		t.Fatalf("want the page with demo b over budget, got %v", err)
	}
	if strings.Contains(err.Error(), "/a/index.html: CSS") || strings.Contains(err.Error(), "/index.html: CSS totals "+fmt.Sprint(Budgets.CSS)) {
		t.Fatalf("a page within budget was reported:\n%v", err)
	}
}

func TestCheckFindsProblems(t *testing.T) {
	out := t.TempDir()
	write := func(name, s string) {
		if err := writeFile(filepath.Join(out, name), []byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", `<html lang="en"><title>t</title><meta name="viewport"><a href="/missing/">x</a><a href="https://example.com/">ok</a><link rel="stylesheet" href="/big.css">`)
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

// TestReelStale fails the build when a live demo's UI changed after its clip
// was recorded, and when a live demo has no clip.
func TestReelStale(t *testing.T) {
	live := strings.Replace(goodProject, "demo: planned", "demo: live\ndemo_try: Try it.", 1)
	src := testFS(live)
	withClip(t, src)
	src["web/demos/demo/ui.js"] = &fstest.MapFile{Data: []byte("export function mount(){ return 1 }")}
	if err := Build(Config{Src: src, Out: t.TempDir(), Owner: DefaultOwner, Now: time.Now()}); err == nil || !strings.Contains(err.Error(), "reel clips out of date for demo") {
		t.Errorf("changed ui.js: got %v, want a stale reel clip", err)
	}
	src = testFS(live)
	withClip(t, src)
	delete(src, "web/reel/demo.mp4")
	if err := Build(Config{Src: src, Out: t.TempDir(), Owner: DefaultOwner, Now: time.Now()}); err == nil || !strings.Contains(err.Error(), "no reel clip") {
		t.Errorf("missing clip: got %v, want a missing reel clip", err)
	}
}

// The stage's scenes are scenes the raytracer demo offers, under its labels,
// and the first is the one the poster shows.
func TestStageScenes(t *testing.T) {
	ui, err := os.ReadFile("../../web/demos/raytracer/ui.js")
	if err != nil {
		t.Fatal(err)
	}
	if StageScenes[0].ID != HomeStage.Scene {
		t.Errorf("first stage scene %q, poster scene %q", StageScenes[0].ID, HomeStage.Scene)
	}
	for _, s := range StageScenes {
		if want := fmt.Sprintf("[%q, %q]", s.ID, s.Name); !strings.Contains(string(ui), want) {
			t.Errorf("raytracer ui.js has no %s", want)
		}
	}
}

func TestLanguages(t *testing.T) {
	got := languages([]Project{{Lang: "Rust"}, {Lang: "Go"}, {Lang: "Rust, Swift"}, {Lang: "Go"}, {Lang: "C++"}, {Lang: "Go"}})
	if want := []string{"Go", "Rust", "Swift", "C++"}; !slices.Equal(got, want) {
		t.Errorf("languages = %v, want %v", got, want)
	}
}

// Every live project has terminal tries, each `method [json object]`.
func TestShellTries(t *testing.T) {
	projects, err := LoadProjects(os.DirFS("../.."))
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range checkTries(projects) {
		t.Error(b)
	}
	if bad := checkTries([]Project{{Slug: "kvlite"}}); len(bad) == 0 {
		t.Error("checkTries accepted tries for a project that is not live")
	}
}
