package site

import (
	"slices"
	"testing"
)

func TestCallLabels(t *testing.T) {
	e := Excerpt{Calls: []string{"render sampling=nee", "plan exclude=", "step"}}
	want := []string{"render sampling=nee", "plan with no exclude", "step"}
	if got := e.CallLabels(); !slices.Equal(got, want) {
		t.Fatalf("CallLabels = %q, want %q", got, want)
	}
	if got := e.CallList(); got != "render sampling=nee|plan exclude=|step" {
		t.Fatalf("CallList = %q", got)
	}
}

func TestCodeSetShortAndDigest(t *testing.T) {
	c := CodeSet{Ref: "0123456789abcdef", Sum: "stale"}
	if c.Short() != "0123456" {
		t.Fatalf("Short = %q", c.Short())
	}
	d := c.Digest()
	c.Sum = "other"
	if c.Digest() != d {
		t.Fatal("Digest must ignore Sum")
	}
	c.Ref = "fedcba9876543210"
	if c.Digest() == d {
		t.Fatal("Digest must change when the content changes")
	}
}

func TestExcerptHTML(t *testing.T) {
	e := Excerpt{Lines: []string{`<span class="tk">go</span>`}}
	if got := string(e.HTML(0)); got != `<span class="tk">go</span>` {
		t.Fatalf("HTML = %q", got)
	}
}
