package site

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

// Budgets are hard limits checked on every build. Raising one is a decision
// recorded in PLAN.md, never a quick fix to get the gate green.
var Budgets = struct {
	PageHTML    int // bytes, per HTML file
	CSS         int // bytes, the CSS one page loads: site CSS plus the largest demo ui.css
	JSPerDemo   int // bytes, one demo's ui.js
	WASMGzipped int // bytes, one demo's .wasm after gzip -9
	Fonts       int // bytes, all .woff2 together
	ShareImage  int // bytes, one og:image PNG
}{
	PageHTML:    60 << 10,
	CSS:         40 << 10,
	JSPerDemo:   60 << 10,
	WASMGzipped: 2304 << 10,
	Fonts:       32 << 10,
	ShareImage:  100 << 10,
}

// DemoTokens are the site.css properties a demo's ui.css may read
// (docs/demo-contract.md); other names in site.css may change without notice.
var DemoTokens = map[string]bool{
	"--bg": true, "--surface": true, "--sunken": true, "--line": true, "--line-strong": true,
	"--control-line": true, "--text": true, "--text-2": true, "--text-3": true, "--accent": true,
	"--accent-tint": true, "--live": true, "--danger": true, "--mono": true, "--sans": true, "--r-1": true,
}

var (
	refAttr = regexp.MustCompile(`(?:href|src)="([^"#?]+)`)
	ogImage = regexp.MustCompile(`property="og:image" content="https?://[^/"]+(/[^"]*)"`)
	cssUse  = regexp.MustCompile(`var\((--[\w-]+)`)
	cssDef  = regexp.MustCompile(`(--[\w-]+)\s*:`)
)

// Check walks a built site: every internal link resolves, every page has a
// title, a description and lang, every asset is within budget, and demo
// stylesheets read only the tokens the demo contract lists.
func Check(out string) error {
	var problems []string
	add := func(format string, a ...any) { problems = append(problems, fmt.Sprintf(format, a...)) }
	css, fonts, demoCSS, heaviest := 0, 0, 0, ""
	var wasmRel []string
	var wasm [][]byte
	err := filepath.WalkDir(out, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel := filepath.ToSlash(strings.TrimPrefix(p, out))
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		switch path.Ext(p) {
		case ".html":
			if len(b) > Budgets.PageHTML {
				add("%s: %d bytes of HTML, budget %d", rel, len(b), Budgets.PageHTML)
			}
			for _, need := range []string{`<html lang="`, "<title>", `name="description"`, `name="viewport"`} {
				if !bytes.Contains(b, []byte(need)) {
					add("%s: missing %s", rel, need)
				}
			}
			for _, m := range ogImage.FindAllSubmatch(b, -1) {
				if _, err := os.Stat(filepath.Join(out, filepath.FromSlash(string(m[1])))); err != nil {
					add("%s: og:image %s does not exist", rel, m[1])
				}
			}
			for _, m := range refAttr.FindAllSubmatch(b, -1) {
				ref := string(m[1])
				if !strings.HasPrefix(ref, "/") || strings.HasPrefix(ref, "//") {
					continue // external or mailto
				}
				target := filepath.Join(out, filepath.FromSlash(ref))
				if strings.HasSuffix(ref, "/") {
					target = filepath.Join(target, "index.html")
				}
				if _, err := os.Stat(target); err != nil {
					add("%s: broken link %s", rel, ref)
				}
			}
		case ".png":
			if strings.HasPrefix(rel, "/og/") && len(b) > Budgets.ShareImage {
				add("%s: %d bytes, budget %d", rel, len(b), Budgets.ShareImage)
			}
		case ".css":
			if !strings.HasPrefix(rel, "/demos/") {
				css += len(b)
			} else {
				if len(b) > demoCSS {
					demoCSS, heaviest = len(b), rel
				}
				own := map[string]bool{}
				for _, m := range cssDef.FindAllSubmatch(b, -1) {
					own[string(m[1])] = true
				}
				for _, m := range cssUse.FindAllSubmatch(b, -1) {
					if name := string(m[1]); !DemoTokens[name] && !own[name] {
						add("%s: reads %s, which is not a demo token (docs/demo-contract.md)", rel, name)
					}
				}
			}
		case ".woff2":
			fonts += len(b)
		case ".js":
			if strings.HasPrefix(rel, "/demos/") && len(b) > Budgets.JSPerDemo {
				add("%s: %d bytes, budget %d", rel, len(b), Budgets.JSPerDemo)
			}
		case ".wasm":
			wasmRel, wasm = append(wasmRel, rel), append(wasm, b)
		}
		return nil
	})
	if err != nil {
		return err
	}
	// gzip -9 of every binary took ~2.5 s in a row on CI (F5 in docs/tasks.md).
	for i, n := range gzipSizes(wasm) {
		if n > Budgets.WASMGzipped {
			add("%s: %d bytes gzipped, budget %d", wasmRel[i], n, Budgets.WASMGzipped)
		}
	}
	if css+demoCSS > Budgets.CSS {
		add("CSS totals %d bytes on the heaviest page (site CSS + %s), budget %d", css+demoCSS, heaviest, Budgets.CSS)
	}
	if fonts > Budgets.Fonts {
		add("fonts total %d bytes, budget %d", fonts, Budgets.Fonts)
	}
	if len(problems) > 0 {
		return fmt.Errorf("site check failed:\n  %s", strings.Join(problems, "\n  "))
	}
	return nil
}

// gzipSizes gzips each file concurrently and returns the sizes in order.
func gzipSizes(files [][]byte) []int {
	sizes := make([]int, len(files))
	sem := make(chan struct{}, runtime.GOMAXPROCS(0))
	var wg sync.WaitGroup
	for i, b := range files {
		wg.Go(func() {
			sem <- struct{}{}
			defer func() { <-sem }()
			sizes[i] = gzipSize(b)
		})
	}
	wg.Wait()
	return sizes
}

func gzipSize(b []byte) int {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(b)
	w.Close()
	return buf.Len()
}
