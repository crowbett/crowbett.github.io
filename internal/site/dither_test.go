package site

import (
	"os"
	"strings"
	"testing"
)

func TestMaskSheetsCoverEveryProjectAndSize(t *testing.T) {
	src := os.DirFS("../..")
	projects, err := LoadProjects(src)
	if err != nil {
		t.Fatal(err)
	}
	sheets, err := MaskSheets(Config{Src: src})
	if err != nil {
		t.Fatal(err)
	}
	if len(sheets) != len(projects)*len(MaskSizes) {
		t.Fatalf("%d sheets, want %d projects x %d sizes", len(sheets), len(projects), len(MaskSizes))
	}
	for _, p := range projects {
		for _, m := range MaskSizes {
			b, ok := sheets[p.Slug+"-"+m.Name]
			if !ok || !strings.Contains(string(b), string(maskTone)) {
				t.Errorf("sheet %s-%s missing or lacks the mask tone", p.Slug, m.Name)
			}
		}
	}
}
