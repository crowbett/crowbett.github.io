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
	DenyY   float64 // baseline of the denied lane
	LaneY   float64 // label baseline at the top of the allowed lane
	Bars    []heroBar
	// Attack window (buckets offered over twice the limit), in chart units.
	AttackX, AttackW, AttackMid float64
	Burst1X, Burst1Y            float64 // label anchor for the first attack bucket, which spends the burst
	// Fade-in step (1-5) for each label, so it appears once the wipe has passed it.
	AttackStep, BurstStep int
}

type heroBar struct{ X, AY, AH, DY, DH float64 }

// Chart geometry in viewBox units (480 x 160, drawn at its real aspect so
// labels keep their shape): two lanes on one time axis, one 8-unit column per
// bucket. Denied requests rise from y=84 under an 18-unit label band; allowed
// requests rise from y=160 on their own scale, with the limit at mid-lane, so
// the attack's size and the flat allowed line both read at a glance.
const (
	heroW, heroH, heroCol, heroBarW = 480.0, 160.0, 8.0, 6.0
	heroDenyBase, heroDenyPlot      = 84.0, 66.0
	heroAllowPlot                   = 60.0
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
	ha, hd := 2*limit, 1.0
	for i := range s.Allowed {
		ha = max(ha, float64(s.Allowed[i])*1.1)
		hd = max(hd, float64(s.Denied[i]))
	}
	col := heroW / float64(len(r.Offered))
	scaleA, scaleD := heroAllowPlot/ha, heroDenyPlot/hd
	round := func(v float64) float64 { return float64(int(v*100+0.5)) / 100 }
	t := &heroTrace{
		Slug: f.Slug, Algo: strings.ToUpper(s.Algo), Pattern: f.Params.Pattern,
		Rate: f.Params.Rate, Burst: f.Params.Burst, Seconds: f.Params.DurationMs / 1000,
		Allowed: s.TotalAllowed, Denied: s.TotalDenied,
		W: heroW, H: heroH, BarW: round(col * heroBarW / heroCol),
		Limit: int(limit + 0.5), LimitY: round(heroH - limit*scaleA), DenyY: heroDenyBase, LaneY: heroH - heroAllowPlot + 12,
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
		a, d := float64(s.Allowed[i])*scaleA, float64(s.Denied[i])*scaleD
		x := float64(i)*col + (col-col*heroBarW/heroCol)/2
		t.Bars = append(t.Bars, heroBar{X: round(x), AY: round(heroH - a), AH: round(a), DY: round(heroDenyBase - d), DH: round(d)})
	}
	if first >= 0 {
		t.AttackX, t.AttackW = round(float64(first)*col), round(float64(last-first+1)*col)
		t.AttackMid = round(t.AttackX + t.AttackW/2)
		t.AttackStep = heroStep(t.AttackMid + 40)
		if float64(s.Allowed[first]) > limit {
			t.Burst1X, t.Burst1Y = round(t.AttackX-4), t.Bars[first].AY-4
			t.BurstStep = heroStep(t.AttackX + col)
		}
	}
	return t, nil
}

// heroStep is the fifth of the chart the wipe must pass before x is drawn.
func heroStep(x float64) int {
	return min(5, max(1, int(x/heroW*5)+1))
}
