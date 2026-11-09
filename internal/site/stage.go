package site

import (
	"encoding/json"
	"fmt"
	"io/fs"
)

// Stage is the home page's live render: the raytracer demo's real build
// traces Scene at Width px, seed Seed, with material-only sampling left of
// the split and NEE + MIS right, so both halves always hold equal samples per
// pixel. It stops at MaxSpp. The poster is the same render at PosterSpp,
// captured from the build by cmd/stage.
type Stage struct {
	Slug, Scene                       string
	Width, Seed, PosterSpp, MaxSpp    int
	SceneLabel, LeftLabel, RightLabel string
}

var HomeStage = Stage{
	Slug: "raytracer", Scene: "cornell", Width: 480, Seed: 1, PosterSpp: 64, MaxSpp: 512,
	SceneLabel: "Cornell box", LeftLabel: "material only", RightLabel: "NEE + MIS",
}

const (
	StagePoster = "web/reel/stage.webp"
	StageSums   = "web/reel/.stage"
)

// StageSource is what the stage poster was rendered from: the pinned
// binary's lock entry and the stage parameters.
func StageSource(src fs.FS) ([]byte, error) {
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
	for _, d := range lock.Demos {
		var e struct{ Slug string }
		if err := json.Unmarshal(d, &e); err != nil {
			return nil, err
		}
		if e.Slug == HomeStage.Slug {
			return fmt.Appendf(append([]byte(nil), d...), "%#v", HomeStage), nil
		}
	}
	return nil, fmt.Errorf("home stage: demos.lock.json has no %s build", HomeStage.Slug)
}

// checkStage fails the build when the stage poster is missing or was
// rendered from another build or other parameters.
func checkStage(cfg Config) error {
	if _, err := fs.Stat(cfg.Src, StagePoster); err != nil {
		return fmt.Errorf("no home stage poster %s: run `go run ./cmd/stage`", StagePoster)
	}
	item, err := StageSource(cfg.Src)
	if err != nil {
		return err
	}
	return checkSums(cfg, StageSums, map[string][]byte{"stage": item}, nil, "home stage poster", "go run ./cmd/stage")
}
