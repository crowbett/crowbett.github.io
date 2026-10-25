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
	W, H    float64 // viewBox
	BarW    float64
	Limit   int // requests per bucket
	LimitY  float64
	Bars    []heroBar
	// Attack window (buckets offered over twice the limit), in chart units.
	AttackX, AttackW, AttackMid float64
	Burst1X, Burst1Y            float64 // label anchor for the first attack bucket, which spends the burst
}

type heroBar struct{ X, AY, AH, DY, DH float64 }

// Chart geometry in viewBox units (480 x 160, drawn at its real aspect so
// labels keep their shape): one 8-unit column per bucket, bars from y=160 up
// to a 138-unit plot under a label band.
const (
	heroW, heroH, heroPlot, heroCol, heroBarW = 480.0, 160.0, 138.0, 8.0, 6.0
)

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
	col := heroW / float64(len(r.Offered))
	scale := heroPlot / h
	round := func(v float64) float64 { return float64(int(v*100+0.5)) / 100 }
	t := &heroTrace{
		Slug: f.Slug, Algo: strings.ToUpper(s.Algo), Pattern: f.Params.Pattern,
		Rate: f.Params.Rate, Burst: f.Params.Burst, Seconds: f.Params.DurationMs / 1000,
		Allowed: s.TotalAllowed, Denied: s.TotalDenied,
		W: heroW, H: heroH, BarW: round(col * heroBarW / heroCol),
		Limit: int(limit + 0.5), LimitY: round(heroH - limit*scale),
	}
	first, last := -1, -1
	for i, o := range r.Offered {
		if float64(o) > 2*limit {
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	for i := range s.Allowed {
		a, d := float64(s.Allowed[i])*scale, float64(s.Denied[i])*scale
		x := float64(i)*col + (col-col*heroBarW/heroCol)/2
		y := heroH - a
		t.Bars = append(t.Bars, heroBar{X: round(x), AY: round(y), AH: round(a), DY: round(y - d), DH: round(d)})
	}
	if first >= 0 {
		t.AttackX, t.AttackW = round(float64(first)*col), round(float64(last-first+1)*col)
		t.AttackMid = round(t.AttackX + t.AttackW/2)
		if float64(s.Allowed[first]) > limit {
			t.Burst1X, t.Burst1Y = round(t.AttackX-4), t.Bars[first].AY-4
		}
	}
	return t, nil
}
