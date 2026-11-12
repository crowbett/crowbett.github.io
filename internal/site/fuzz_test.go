package site

import "testing"

func FuzzParseProject(f *testing.F) {
	f.Add(goodProject)
	f.Add("---\ntitle: x\n---\n")
	f.Add("---\n---\n")
	f.Add("no front matter")
	f.Add("---\ntitle: a\ntagline: b\nlang: Go\norder: -1\nmetric: 9 x\nmetric_source: s\n---\n- **bold** `code` [l](u)")
	f.Fuzz(func(t *testing.T, src string) {
		p, err := parseProject("demo", []byte(src))
		if err == nil && (p.Title == "" || p.Tagline == "") {
			t.Fatalf("accepted a page without title or tagline: %+v", p)
		}
	})
}

func FuzzFigures(f *testing.F) {
	for _, s := range []string{"p99 latency 2.33x faster", "400x225 &#39;3DBenchy&#39; BM25", "1,234 and 5x", "x1 1x x", ""} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		out := string(figures(s))
		if len(out) < len(s)/2 {
			t.Fatalf("figures shrank %q to %q", s, out)
		}
	})
}
