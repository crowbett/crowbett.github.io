package site

import "testing"

func TestFigures(t *testing.T) {
	for in, want := range map[string]string{
		"BM25 query latency p50 1.2–2.2 ms": "BM25\u00a0query latency p50\u00a0<b>1.2</b>–<b>2.2</b> ms",
		"a 3DBenchy with 5,868 facets":      "a 3DBenchy with <b>5,868</b> facets",
		"stored 2.33x smaller":              "stored <b>2.33</b>x smaller",
		"(400x225, 50 spp)":                 "(<b>400</b>x<b>225</b>, <b>50</b> spp)",
		"the book's 1 cover":                "the book&#39;s <b>1</b> cover",
	} {
		if got := string(figures(in)); got != want {
			t.Errorf("figures(%q) = %q, want %q", in, got, want)
		}
	}
}
