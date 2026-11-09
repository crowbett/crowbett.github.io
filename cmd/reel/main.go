// Command reel records the preview clips: headless Chrome opens each live
// demo from dist, starts the real WebAssembly build, plays the demo's
// showcase (internal/site/showcase.go) and screencasts its frame, once laid
// out as wide as a desktop panel's screen (web/reel/<slug>.mp4) and once at
// phone width (<slug>-n.mp4). ffmpeg encodes each plus a first-frame poster, and
// web/reel/.sums ties each clip to its pinned binary, UI and showcase so the
// build fails when one goes stale.
//
//	go run ./cmd/reel [slug...]
package main

import (
	"context"
	"errors"
	"fmt"
	"image/png"
	"io/fs"
	"log"
	"maps"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

const (
	out    = "web/reel"
	height = 900
	fps    = 30
	aspect = 10.0 / 16
)

// A variant is one recording of a demo. Wide lays the page out so the mount
// is as wide as a home panel's screen at 1440 px (705 CSS px), so on a
// desktop the clip plays at the demo's own size; narrow is the phone layout,
// drawn at 3x since a phone shows it at about 0.75.
type variant struct {
	suffix       string
	width, scale int
	wide         bool
}

var variants = []variant{{"", 752, 2, true}, {"-n", 480, 3, false}}

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(only []string) error {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}
	dist, err := os.MkdirTemp("", "reel-dist")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dist)
	cfg := site.Config{Src: os.DirFS("."), Out: dist, Owner: site.DefaultOwner, Now: time.Now(), Recording: true}
	if err := site.Build(cfg); err != nil {
		return err
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(dist)))
	defer srv.Close()

	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	sources, err := site.ReelSources(os.DirFS("."))
	if err != nil {
		return err
	}
	slugs := only
	if len(slugs) == 0 {
		slugs = slices.Sorted(maps.Keys(sources))
	}
	for _, slug := range slugs {
		if _, ok := site.Showcases[slug]; !ok || sources[slug] == nil {
			return fmt.Errorf("%s: not a live demo with a showcase", slug)
		}
	}
	// The screencast is drawn at the browser's device scale, so each variant
	// gets a browser of its own.
	for _, v := range variants {
		if err := recordAll(srv.URL, slugs, v); err != nil {
			return err
		}
	}
	for _, slug := range slugs {
		if err := writeSum(slug, sources[slug]); err != nil {
			return err
		}
	}
	return nil
}

func recordAll(base string, slugs []string, v variant) error {
	opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.Flag("mute-audio", true), chromedp.Flag("force-device-scale-factor", fmt.Sprint(v.scale)), chromedp.DisableGPU, chromedp.WindowSize(v.width, height))
	actx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer cancel()
	browser, cancel := chromedp.NewContext(actx)
	defer cancel()
	if err := chromedp.Do(browser); err != nil {
		return err
	}
	for _, slug := range slugs {
		start := time.Now()
		if err := record(browser, base, slug, site.Showcases[slug], v); err != nil {
			return fmt.Errorf("%s%s: %w", slug, v.suffix, err)
		}
		fi, _ := os.Stat(filepath.Join(out, slug+v.suffix+".mp4"))
		log.Printf("%s%s: %d B in %v", slug, v.suffix, fi.Size(), time.Since(start).Round(time.Millisecond))
	}
	return nil
}

// writeSum records in web/reel/.sums what slug's clip was made from.
func writeSum(slug string, source []byte) error {
	sum, err := site.ImageSum(os.DirFS("."), source, nil)
	if err != nil {
		return err
	}
	b, err := os.ReadFile(site.ReelSums)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	sums := map[string]string{slug: sum}
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if name, s, ok := strings.Cut(line, " "); ok && name != slug {
			sums[name] = s
		}
	}
	var out strings.Builder
	for _, name := range slices.Sorted(maps.Keys(sums)) {
		fmt.Fprintf(&out, "%s %s\n", name, sums[name])
	}
	return os.WriteFile(site.ReelSums, []byte(out.String()), 0o644)
}

type frame struct {
	path string
	at   float64
	dip  float64 // the frame's width in CSS px
}

func record(browser context.Context, base, slug string, show site.Showcase, v variant) error {
	ctx, cancel := chromedp.NewContext(browser)
	defer cancel()
	ctx, cancelT := context.WithTimeout(ctx, 3*time.Minute)
	defer cancelT()

	tmp, err := os.MkdirTemp("", "reel-"+slug)
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	err = chromedp.Do(ctx,
		chromedp.EmulateViewport(int64(v.width), height, chromedp.EmulateScale(float64(v.scale))),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
				Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "dark"}},
			})
			return err
		}),
		chromedp.Navigate(base+"/projects/"+slug+"/"),
	)
	if err != nil {
		return err
	}
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector("[data-demo-start]").click(), true`)); err != nil {
		return err
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`"demoReady" in document.querySelector("[data-demo]").dataset`, chromedp.WithPollingTimeout(2*time.Minute))); err != nil {
		return err
	}
	if show.Setup != "" {
		if _, err := chromedp.Run(ctx, chromedp.Evaluate[any](show.Setup, chromedp.EvalAwaitPromise)); err != nil {
			return fmt.Errorf("setup: %w", err)
		}
	}
	focus, pad := show.Focus, show.Pad
	if v.wide {
		focus, pad = show.WideFocus, show.WidePad
	}
	if focus == "" {
		focus = "[data-demo-mount]"
	}
	rect, err := chromedp.Run(ctx, chromedp.Evaluate[box](fmt.Sprintf(`((sel, pad) => {
		const m = document.querySelector(sel);
		document.activeElement?.blur();
		for (const e of document.querySelectorAll("body *")) {
			const p = getComputedStyle(e).position;
			if ((p === "fixed" || p === "sticky") && !e.closest("[data-demo]")) e.style.setProperty("visibility", "hidden", "important");
		}
		for (const a of document.getAnimations()) if (!(a.timeline instanceof DocumentTimeline)) a.cancel();
		scrollTo(0, m.getBoundingClientRect().top + scrollY - pad);
		const r = m.getBoundingClientRect(), b = document.querySelector("[data-demo-mount]").getBoundingClientRect();
		return {x: b.x, y: Math.max(r.y - pad, 0), w: b.width};
	})(%q, %d)`, focus, pad)))
	if err != nil {
		return err
	}
	// Entrances finish and the scrolled-to tiles rasterize before the cast.
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))).then(() => true)`, chromedp.EvalAwaitPromise)); err != nil {
		return err
	}
	time.Sleep(time.Second)

	var mu sync.Mutex
	var frames []frame
	events := chromedp.Events(ctx, page.ScreencastFrame)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for e, err := range events {
			if err != nil {
				return
			}
			p := filepath.Join(tmp, fmt.Sprintf("%05d.png", len(frames)))
			if os.WriteFile(p, e.Data, 0o644) == nil {
				mu.Lock()
				frames = append(frames, frame{p, e.Metadata.Timestamp.Float64(), e.Metadata.DeviceWidth})
				mu.Unlock()
			}
			id := e.SessionID
			go chromedp.Do(ctx, chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
				_, err := cdp.Call(ctx, t, page.ScreencastFrameAck, page.ScreencastFrameAckParams{SessionID: id})
				return err
			}))
		}
	}()
	screencast := func(on bool) error {
		return chromedp.Do(ctx, chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			if !on {
				_, err := cdp.Call(ctx, t, page.StopScreencast, cdp.Empty{})
				return err
			}
			_, err := cdp.Call(ctx, t, page.StartScreencast, page.StartScreencastParams{Format: page.StartScreencastFormatPng, EveryNthFrame: 1, MaxWidth: int64(2 * v.width * v.scale), MaxHeight: int64(2 * height * v.scale)})
			return err
		}))
	}
	if err := screencast(true); err != nil {
		return err
	}
	// The first frame can predate a canvas's first paint (a blank frame that
	// would become the poster); the clip opens on the newest one after 300 ms.
	time.Sleep(300 * time.Millisecond)
	mu.Lock()
	skip := max(len(frames)-1, 0)
	mu.Unlock()
	began := time.Now()
	if show.Play != "" {
		if _, err := chromedp.Run(ctx, chromedp.Evaluate[any](show.Play, chromedp.EvalAwaitPromise)); err != nil {
			return fmt.Errorf("play: %w", err)
		}
	}
	if rest := show.Seconds - time.Since(began).Seconds(); rest > 0 {
		time.Sleep(time.Duration(rest * float64(time.Second)))
	}
	if err := screencast(false); err != nil {
		return err
	}
	mu.Lock()
	got := append([]frame(nil), frames[min(skip, len(frames)):]...)
	mu.Unlock()
	if len(got) == 0 {
		return errors.New("no frames")
	}
	return encode(tmp, slug+v.suffix, got, rect.X, rect.Y, rect.W, show.Seconds)
}

type box struct{ X, Y, W float64 }

// encode turns the timed frames into a constant-rate clip cropped to the
// demo mount, and saves its first frame as the poster.
func encode(tmp, slug string, frames []frame, x, y, w, seconds float64) error {
	var list strings.Builder
	t0 := frames[0].at
	for i, f := range frames {
		d := seconds - (f.at - t0)
		if i+1 < len(frames) {
			d = frames[i+1].at - f.at
		}
		fmt.Fprintf(&list, "file '%s'\nduration %.4f\n", f.path, math.Max(d, 0.001))
	}
	fmt.Fprintf(&list, "file '%s'\n", frames[len(frames)-1].path)
	lp := filepath.Join(tmp, "list.txt")
	if err := os.WriteFile(lp, []byte(list.String()), 0o644); err != nil {
		return err
	}
	f, err := os.Open(frames[0].path)
	if err != nil {
		return err
	}
	cfg, err := png.DecodeConfig(f)
	f.Close()
	if err != nil {
		return err
	}
	// The screencast may cover more than the layout viewport, so the scale
	// comes from the frame's own width.
	k := float64(cfg.Width) / frames[0].dip
	even := func(v float64) int { return int(v*k) &^ 1 }
	crop := fmt.Sprintf("crop=%d:%d:%d:%d", even(w), even(w*aspect), even(x), even(y))
	mp4 := filepath.Join(out, slug+".mp4")
	// Quality steps down only for a clip that would pass 90% of its budget
	// (noisy frames, like the path tracer's early passes, cost the most).
	for crf := 26; ; crf += 2 {
		enc := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lp,
			"-vf", crop+fmt.Sprintf(",fps=%d,format=yuv420p", fps), "-t", fmt.Sprint(seconds),
			"-c:v", "libx264", "-preset", "veryslow", "-crf", fmt.Sprint(crf), "-tune", "animation",
			"-movflags", "+faststart", "-an", mp4)
		enc.Stderr = os.Stderr
		if err := enc.Run(); err != nil {
			return err
		}
		fi, err := os.Stat(mp4)
		if err != nil {
			return err
		}
		if fi.Size() <= int64(site.Budgets.ReelClip)*9/10 || crf >= 36 {
			break
		}
	}
	poster := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-frames:v", "1", "-c:v", "libwebp", "-quality", "80", filepath.Join(out, slug+".webp"))
	poster.Stderr = os.Stderr
	return poster.Run()
}
