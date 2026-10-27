package site

import (
	"bytes"
	"fmt"
	"html/template"
	"io/fs"
	"strings"
)

// MaskSums is where cmd/dither records the hash of each sheet it dithered.
const MaskSums = "web/assets/dg/.sums"

// MaskSize is one tile of a project's diagram mask, in CSS pixels: one mask
// pixel per CSS pixel, so it is only ever drawn at whole multiples.
type MaskSize struct {
	Name   string
	W, H   int
	Labels bool
}

// MaskSizes: "s" for the index and the home share card, "l" (with labels)
// for the project facts column and the project share cards.
var MaskSizes = []MaskSize{{"s", 112, 54, false}, {"l", 224, 108, true}}

// MaskDeps are the files a mask sheet loads besides its own HTML.
var MaskDeps = []string{"web/assets/fonts/martian-mono.woff2"}

// maskTone is the grey that node fills dither to.
const maskTone = template.CSS("#d4d4d4")

// MaskSheets renders the 2x2 sheet (template "dither") for every project and
// size, keyed "<slug>-<size>". cmd/dither screenshots and dithers each into
// web/assets/dg/<key>.png.
func MaskSheets(cfg Config) (map[string][]byte, error) {
	s, err := prepare(cfg)
	if err != nil {
		return nil, err
	}
	return s.maskSheets()
}

func (s *prepared) maskSheets() (map[string][]byte, error) {
	if s.tmpl.Lookup("dither") == nil {
		return nil, nil
	}
	sheets := map[string][]byte{}
	for _, p := range s.projects {
		for _, m := range MaskSizes {
			var b bytes.Buffer
			err := s.tmpl.ExecuteTemplate(&b, "dither", struct {
				MaskSize
				Slug string
				Tone template.CSS
			}{m, p.Slug, maskTone})
			if err != nil {
				return nil, fmt.Errorf("mask sheet %s-%s: %w", p.Slug, m.Name, err)
			}
			sheets[p.Slug+"-"+m.Name] = b.Bytes()
		}
	}
	return sheets, nil
}

// checkMasks fails the build when a drawing changed since its mask was
// dithered, or when site.css has no mask rule for a project.
func checkMasks(cfg Config, s *prepared) error {
	sheets, err := s.maskSheets()
	if err != nil || sheets == nil {
		return err
	}
	if err := checkSums(cfg, MaskSums, sheets, MaskDeps, "diagram masks", "go run ./cmd/dither"); err != nil {
		return err
	}
	css, err := fs.ReadFile(cfg.Src, "web/assets/site.css")
	if err != nil {
		return err
	}
	for _, p := range s.projects {
		if !strings.Contains(string(css), ".dm-"+p.Slug+" {") {
			return fmt.Errorf("site.css: no .dm-%s rule for %s's diagram mask", p.Slug, p.Slug)
		}
	}
	return nil
}
