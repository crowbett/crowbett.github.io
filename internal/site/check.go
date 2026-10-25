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
	"strings"
)

// Budgets are hard limits checked on every build. Raising one is a decision
// recorded in PLAN.md, never a quick fix to get the gate green.
var Budgets = struct {
	PageHTML    int // bytes, per HTML file
	CSS         int // bytes, all CSS together
	JSPerDemo   int // bytes, one demo's ui.js
	WASMGzipped int // bytes, one demo's .wasm after gzip -9
}{
	PageHTML:    60 << 10,
	CSS:         40 << 10,
	JSPerDemo:   60 << 10,
	WASMGzipped: 2 << 20,
}

var refAttr = regexp.MustCompile(`(?:href|src)="([^"#?]+)`)

// Check walks a built site: every internal link resolves, every page has a
// title, a description and lang, and every asset is within budget.
func Check(out string) error {
	var problems []string
	add := func(format string, a ...any) { problems = append(problems, fmt.Sprintf(format, a...)) }
	css := 0
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
		case ".css":
			css += len(b)
		case ".js":
			if strings.HasPrefix(rel, "/demos/") && len(b) > Budgets.JSPerDemo {
				add("%s: %d bytes, budget %d", rel, len(b), Budgets.JSPerDemo)
			}
		case ".wasm":
			if n := gzipSize(b); n > Budgets.WASMGzipped {
				add("%s: %d bytes gzipped, budget %d", rel, n, Budgets.WASMGzipped)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if css > Budgets.CSS {
		add("CSS totals %d bytes, budget %d", css, Budgets.CSS)
	}
	if len(problems) > 0 {
		return fmt.Errorf("site check failed:\n  %s", strings.Join(problems, "\n  "))
	}
	return nil
}

func gzipSize(b []byte) int {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(b)
	w.Close()
	return buf.Len()
}
