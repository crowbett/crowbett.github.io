package site

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
)

// ReelSums is where cmd/reel records what each preview clip was made from.
const ReelSums = "web/reel/.sums"

// Showcase is what a home reel clip shows once the demo is running. Setup
// runs before recording starts and Play while it records; both are JS
// expressions that may return a promise and drive the demo only as a visitor
// would. The clip is a 16:10 crop whose top edge and width are Focus's box
// (the demo mount when empty) grown by Pad CSS px on each side.
type Showcase struct {
	Setup, Play, Focus string
	Pad                int
	Seconds            float64
}

// ReelSources is, per live demo, what its clip was recorded from: the pinned
// binary's lock entry, the demo's UI and its showcase. A change to any of
// them makes the clip stale, so the reel never shows a demo that no longer
// looks or behaves that way.
func ReelSources(src fs.FS) (map[string][]byte, error) {
	projects, err := LoadProjects(src)
	if err != nil {
		return nil, err
	}
	b, err := fs.ReadFile(src, "demos.lock.json")
	if err != nil {
		return nil, err
	}
	var lock struct {
		Demos []json.RawMessage `json:"demos"`
	}
	if err := json.Unmarshal(b, &lock); err != nil {
		return nil, fmt.Errorf("demos.lock.json: %w", err)
	}
	entries := map[string][]byte{}
	for _, d := range lock.Demos {
		var e struct{ Slug string }
		if err := json.Unmarshal(d, &e); err != nil {
			return nil, err
		}
		entries[e.Slug] = d
	}
	items := map[string][]byte{}
	for _, p := range projects {
		if !p.Live() {
			continue
		}
		show, ok := Showcases[p.Slug]
		if !ok {
			return nil, fmt.Errorf("%s: demo is live but internal/site/showcase.go has no showcase for its reel clip", p.Slug)
		}
		var h bytes.Buffer
		h.Write(entries[p.Slug])
		for _, f := range []string{"ui.js", "ui.css"} {
			ui, err := fs.ReadFile(src, "web/demos/"+p.Slug+"/"+f)
			if err != nil && f == "ui.js" {
				return nil, err
			}
			h.Write(ui)
		}
		fmt.Fprintf(&h, "%#v", show)
		items[p.Slug] = h.Bytes()
	}
	return items, nil
}

// checkReel fails the build when a live demo has no clip or its clip was
// recorded from a different binary, UI or showcase.
func checkReel(cfg Config) error {
	items, err := ReelSources(cfg.Src)
	if err != nil {
		return err
	}
	for slug := range items {
		for _, ext := range []string{".mp4", ".webp"} {
			if _, err := fs.Stat(cfg.Src, "web/reel/"+slug+ext); err != nil {
				return fmt.Errorf("%s: no reel clip web/reel/%s%s: run `go run ./cmd/reel %s`", slug, slug, ext, slug)
			}
		}
	}
	return checkSums(cfg, ReelSums, items, nil, "reel clips", "go run ./cmd/reel")
}
