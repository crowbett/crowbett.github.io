package site

import (
	"encoding/json"
	"html"
	"regexp"
	"strings"
)

// A doc is one searchable piece of a project page for the command palette:
// a paragraph or list item of the write-up ("w"), the measured result ("m"),
// what to try in the demo ("d"), or a code excerpt ("c") with its lines.
type doc struct {
	Slug  string   `json:"s"`
	Kind  string   `json:"k"`
	Text  string   `json:"t"`
	X     int      `json:"x,omitempty"` // excerpt index
	Path  string   `json:"p,omitempty"`
	From  int      `json:"f,omitempty"`
	Why   string   `json:"y,omitempty"`
	Lines []string `json:"l,omitempty"`
}

var (
	blockTag = regexp.MustCompile(`</?(?:p|li|h[1-6]|ul|ol|blockquote|pre|table|tr|td|th)\b[^>]*>`)
	anyTag   = regexp.MustCompile(`<[^>]+>`)
	spaces   = regexp.MustCompile(`\s+`)
)

// prose splits rendered HTML into its blocks' plain text.
func prose(h string) []string {
	var out []string
	for _, b := range strings.Split(blockTag.ReplaceAllString(h, "\n"), "\n") {
		t := strings.TrimSpace(spaces.ReplaceAllString(html.UnescapeString(anyTag.ReplaceAllString(b, "")), " "))
		if len(t) >= 24 {
			out = append(out, t)
		}
	}
	return out
}

// writeFind writes /find.json, the palette's index of every page's text and
// code, loaded once someone types a query.
func writeFind(file string, projects []Project) error {
	var out []doc
	for _, p := range projects {
		if p.Metric != "" {
			out = append(out, doc{Slug: p.Slug, Kind: "m", Text: p.Metric, Why: p.MetricSource})
		}
		if p.Live() && p.DemoTry != "" {
			out = append(out, doc{Slug: p.Slug, Kind: "d", Text: p.DemoTry})
		}
		for _, t := range prose(string(p.Body)) {
			out = append(out, doc{Slug: p.Slug, Kind: "w", Text: t})
		}
		if p.Code != nil {
			for i, e := range p.Code.Excerpts {
				out = append(out, doc{Slug: p.Slug, Kind: "c", Text: e.Title, X: i, Path: e.Path, From: e.From, Why: e.Why, Lines: e.Text})
			}
		}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return err
	}
	return writeFile(file, b)
}
