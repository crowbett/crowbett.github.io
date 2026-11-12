package site

import (
	"strings"
	"testing"
)

func validCodeSet() CodeSet {
	c := CodeSet{
		Slug: "demo",
		Ref:  strings.Repeat("a", 40),
		Excerpts: []Excerpt{{
			Path: "main.go", From: 1, To: 2, Title: "Plan", Why: "It plans the thing.",
			Calls: []string{"render sampling=nee"},
			Text:  []string{"func main() {", "}"},
			Lines: []string{`<span class="tk">func</span> main() {`, "}"},
		}},
	}
	c.Sum = c.Digest()
	return c
}

func TestCodeSetCheck(t *testing.T) {
	live := Project{Slug: "demo", Demo: "live"}
	mut := func(f func(*CodeSet)) CodeSet {
		c := validCodeSet()
		f(&c)
		return c
	}
	resum := func(c *CodeSet) { c.Sum = c.Digest() }
	cases := []struct {
		name    string
		set     CodeSet
		lockRef string
		want    string
	}{
		{"valid", validCodeSet(), strings.Repeat("a", 40), ""},
		{"no lock ref yet", validCodeSet(), "", ""},
		{"wrong slug", mut(func(c *CodeSet) { c.Slug = "other"; resum(c) }), "", `slug "other"`},
		{"short ref", mut(func(c *CodeSet) { c.Ref = "abc"; resum(c) }), "", "full commit"},
		{"other commit", validCodeSet(), strings.Repeat("b", 40), "but the demo runs"},
		{"malformed lock ref", validCodeSet(), "abc", "but the demo runs abc"},
		{"no excerpts", mut(func(c *CodeSet) { c.Excerpts = nil; resum(c) }), "", "0 excerpts"},
		{"hand edit", mut(func(c *CodeSet) { c.Excerpts[0].Why = "edited by hand" }), "", "changed since it was filled"},
		{"not filled", mut(func(c *CodeSet) { c.Excerpts[0].To = 9; resum(c) }), "", "not filled"},
		{"no title", mut(func(c *CodeSet) { c.Excerpts[0].Title = ""; resum(c) }), "", "title (1-40 chars)"},
		{"long why", mut(func(c *CodeSet) { c.Excerpts[0].Why = strings.Repeat("w", 161); resum(c) }), "", "title (1-40 chars)"},
		{"unpublishable", mut(func(c *CodeSet) { c.Excerpts[0].Text[0] = "// mail me@example.com"; resum(c) }), "", "must not publish"},
		{"bad call", mut(func(c *CodeSet) { c.Excerpts[0].Calls = []string{"render {x}"}; resum(c) }), "", "not `method"},
		{"foreign markup", mut(func(c *CodeSet) { c.Excerpts[0].Lines[1] = "<b>}</b>"; resum(c) }), "", "markup other than token spans"},
		{"live demo without a call", mut(func(c *CodeSet) { c.Excerpts[0].Calls = nil; resum(c) }), "", "no excerpt names a demo call"},
	}
	for _, tc := range cases {
		err := tc.set.check(live, tc.lockRef)
		switch {
		case tc.want == "" && err != nil:
			t.Errorf("%s: unexpected error %v", tc.name, err)
		case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
			t.Errorf("%s: error %v, want it to contain %q", tc.name, err, tc.want)
		}
	}
}

func TestCodeSetCheckLimits(t *testing.T) {
	c := validCodeSet()
	c.Excerpts = append(c.Excerpts, c.Excerpts[0], c.Excerpts[0], c.Excerpts[0])
	c.Sum = c.Digest()
	if err := c.check(Project{Slug: "demo"}, ""); err == nil || !strings.Contains(err.Error(), "4 excerpts") {
		t.Errorf("four excerpts accepted: %v", err)
	}
	long := validCodeSet()
	e := &long.Excerpts[0]
	e.Text, e.Lines, e.To = make([]string, 71), make([]string, 71), 71
	long.Sum = long.Digest()
	if err := long.check(Project{Slug: "demo"}, ""); err == nil || !strings.Contains(err.Error(), "keep a project's excerpts to 70") {
		t.Errorf("71 lines accepted: %v", err)
	}
	noCalls := validCodeSet()
	noCalls.Excerpts[0].Calls = nil
	noCalls.Sum = noCalls.Digest()
	if err := noCalls.check(Project{Slug: "demo", Demo: "planned"}, ""); err != nil {
		t.Errorf("a planned demo needs no call: %v", err)
	}
}
