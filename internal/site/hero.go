package site

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"
)

// heroTrace is one recorded demo run (data/hero-trace.json) that the home hero
// draws. e2e TestHeroTrace re-runs it through the real binary on every gate.
type heroTrace struct {
	Slug    string
	Algo    string
	Pattern string
	Rate    int // requests per second
	Burst   int
	Seconds int
	Allowed int
	Denied  int
	W, H    int // viewBox: one unit per bucket, one per request
	LimitY  float64
	Bars    []heroBar
}

type heroBar struct{ X, AY, AH, DY, DH float64 }

func loadHeroTrace(src fs.FS) (*heroTrace, error) {
	b, err := fs.ReadFile(src, "data/hero-trace.json")
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var f struct {
		Slug   string `json:"slug"`
		Params struct {
			Pattern    string `json:"pattern"`
			Rate       int    `json:"rate"`
			Burst      int    `json:"burst"`
			DurationMs int    `json:"durationMs"`
		} `json:"params"`
		Result struct {
			BucketUs   float64 `json:"bucketUs"`
			EmissionUs float64 `json:"emissionUs"`
			Offered    []int   `json:"offered"`
			Series     []struct {
				Algo         string `json:"algo"`
				Allowed      []int  `json:"allowed"`
				Denied       []int  `json:"denied"`
				TotalAllowed int    `json:"totalAllowed"`
				TotalDenied  int    `json:"totalDenied"`
			} `json:"series"`
		} `json:"result"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("data/hero-trace.json: %w", err)
	}
	r := f.Result
	if len(r.Series) == 0 || len(r.Offered) == 0 || r.EmissionUs <= 0 {
		return nil, errors.New("data/hero-trace.json: no recorded result; run e2e with HERO_TRACE=update")
	}
	s := r.Series[0]
	limit := r.BucketUs / r.EmissionUs
	h := limit * 1.15
	for _, o := range r.Offered {
		h = max(h, float64(o))
	}
	t := &heroTrace{
		Slug: f.Slug, Algo: strings.ToUpper(s.Algo), Pattern: f.Params.Pattern,
		Rate: f.Params.Rate, Burst: f.Params.Burst, Seconds: f.Params.DurationMs / 1000,
		Allowed: s.TotalAllowed, Denied: s.TotalDenied,
		W: len(r.Offered), H: int(h + 0.5), LimitY: float64(int(h+0.5)) - limit,
	}
	for i := range s.Allowed {
		a, d := float64(s.Allowed[i]), float64(s.Denied[i])
		y := float64(t.H) - a
		t.Bars = append(t.Bars, heroBar{X: float64(i) + 0.14, AY: y, AH: a, DY: y - d, DH: d})
	}
	return t, nil
}
