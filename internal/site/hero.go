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
	Limit   int // requests per bucket
	// The same run drawn twice: wide beside the headline, tall on phones,
	// where a wide chart would leave the allowed lane a few pixels high.
	Wide, Tall *heroChart
}

// heroChart is one drawing of the trace in viewBox units, at its real aspect
// so labels keep their shape: two lanes on one time axis, each on its own
// scale and each with a labelled reference (the peak denied rate, the limit),
// so the attack's size and the flat allowed line both read at a glance.
type heroChart struct {
	Class  string
	Label  string // what the chart shows, for screen readers
	Attack bool   // the run's pattern is the 10x attack
	Rate   int
	Peak   int // highest denied rate in one bucket, per second
	W, H   float64
	BarW   float64
	LimitY float64
	DenyY  float64 // baseline of the denied lane
	PeakY  float64
	LaneY  float64 // label baseline at the top of the allowed lane
	Bars   []heroBar
	// Attack window (buckets offered over twice the limit).
	AttackX, AttackW, AttackMid float64
	Burst1X, Burst1Y            float64 // label anchor for the first attack bucket, which spends the burst
	// Fade-in step (1-5) for each label, so it appears once the wipe has passed it.
	AttackStep, BurstStep int
}

type heroBar struct{ X, AY, AH, DY, DH float64 }

// heroGeom lays out a chart: a label band, the denied lane, a gap, then the
// allowed lane with the limit at mid-lane; label is the label size in user units.
type heroGeom struct {
	class                            string
	w, band, deny, gap, allow, label float64
}

var (
	heroWide = heroGeom{class: "wide", w: 480, band: 22, deny: 88, gap: 18, allow: 72, label: 11}
	heroTall = heroGeom{class: "tall", w: 320, band: 20, deny: 80, gap: 20, allow: 120, label: 12}
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
	t := &heroTrace{
		Slug: f.Slug, Algo: strings.ToUpper(s.Algo), Pattern: f.Params.Pattern,
		Rate: f.Params.Rate, Burst: f.Params.Burst, Seconds: f.Params.DurationMs / 1000,
		Allowed: s.TotalAllowed, Denied: s.TotalDenied, Limit: int(limit + 0.5),
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
	draw := func(g heroGeom) *heroChart {
		ha, hd := 2*limit, 1.0
		for i := range s.Allowed {
			ha = max(ha, float64(s.Allowed[i])*1.1)
			hd = max(hd, float64(s.Denied[i]))
		}
		h := g.band + g.deny + g.gap + g.allow
		denyBase := g.band + g.deny
		col := g.w / float64(len(r.Offered))
		scaleA, scaleD := g.allow/ha, g.deny/hd
		c := &heroChart{
			Class: g.class, Label: fmt.Sprintf("%s requests allowed and %s denied over %d seconds; allowed traffic stays at the limit through the attack", thousands(s.TotalAllowed), thousands(s.TotalDenied), f.Params.DurationMs/1000),
			Attack: f.Params.Pattern == "attack", Rate: f.Params.Rate,
			Peak: int(hd*1e6/r.BucketUs + 0.5),
			W:    g.w, H: h, BarW: round(col * 0.75),
			LimitY: round(h - limit*scaleA), DenyY: denyBase, PeakY: g.band, LaneY: denyBase + g.gap + g.label + 1,
		}
		for i := range s.Allowed {
			a, d := float64(s.Allowed[i])*scaleA, float64(s.Denied[i])*scaleD
			x := float64(i)*col + col*0.125
			c.Bars = append(c.Bars, heroBar{X: round(x), AY: round(h - a), AH: round(a), DY: round(denyBase - d), DH: round(d)})
		}
		if first >= 0 {
			c.AttackX, c.AttackW = round(float64(first)*col), round(float64(last-first+1)*col)
			c.AttackMid = round(c.AttackX + c.AttackW/2)
			c.AttackStep = heroStep(c.AttackMid+3*g.label, g.w)
			if float64(s.Allowed[first]) > limit {
				c.Burst1X, c.Burst1Y = round(c.AttackX-4), c.Bars[first].AY-4
				c.BurstStep = heroStep(c.AttackX+col, g.w)
			}
		}
		return c
	}
	t.Wide, t.Tall = draw(heroWide), draw(heroTall)
	return t, nil
}

func round(v float64) float64 { return float64(int(v*100+0.5)) / 100 }

// heroStep is the fifth of the chart the wipe must pass before x is drawn.
func heroStep(x, w float64) int {
	return min(5, max(1, int(x/w*5)+1))
}
