// Command reel records the home page's preview clips: headless Chrome opens
// each live demo from dist, starts the real WebAssembly build, plays the
// demo's showcase (internal/site/showcase.go) and screencasts its frame.
// ffmpeg encodes web/reel/<slug>.mp4 plus a first-frame poster, and
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
	width  = 480 // CSS px of the recorded page: narrow, so a clip reads at phone width
	scale  = 2
	aspect = 10.0 / 16
)

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

	opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.Flag("mute-audio", true), chromedp.Flag("force-device-scale-factor", fmt.Sprint(scale)), chromedp.DisableGPU, chromedp.WindowSize(width, 1400))
	actx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer cancel()
	browser, cancel := chromedp.NewContext(actx)
	defer cancel()
	if err := chromedp.Do(browser); err != nil {
		return err
	}
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
		show, ok := site.Showcases[slug]
		if _, live := sources[slug]; !ok || !live {
			return fmt.Errorf("%s: not a live demo with a showcase", slug)
		}
		start := time.Now()
		if err := record(browser, srv.URL, slug, show); err != nil {
			return fmt.Errorf("%s: %w", slug, err)
		}
		fi, _ := os.Stat(filepath.Join(out, slug+".mp4"))
		log.Printf("%s: %d B in %v", slug, fi.Size(), time.Since(start).Round(time.Millisecond))
		if err := writeSum(slug, sources[slug]); err != nil {
			return err
		}
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
}

func record(browser context.Context, base, slug string, show site.Showcase) error {
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
		chromedp.EmulateViewport(width, 1400, chromedp.EmulateScale(scale)),
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
	focus := show.Focus
	if focus == "" {
		focus = "[data-demo-mount]"
	}
	rect, err := chromedp.Run(ctx, chromedp.Evaluate[box](fmt.Sprintf(`((sel, pad) => {
		const m = document.querySelector(sel);
		document.activeElement?.blur();
		scrollTo(0, m.getBoundingClientRect().top + scrollY - pad);
		const r = m.getBoundingClientRect(), b = document.querySelector("[data-demo-mount]").getBoundingClientRect();
		return {x: b.x, y: Math.max(r.y - pad, 0), w: b.width};
	})(%q, %d)`, focus, show.Pad)))
	if err != nil {
		return err
	}
	time.Sleep(300 * time.Millisecond)

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
				frames = append(frames, frame{p, e.Metadata.Timestamp.Float64()})
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
			_, err := cdp.Call(ctx, t, page.StartScreencast, page.StartScreencastParams{Format: page.StartScreencastFormatPng, EveryNthFrame: 1, MaxWidth: int64(width * scale), MaxHeight: int64(1400 * scale)})
			return err
		}))
	}
	if err := screencast(true); err != nil {
		return err
	}
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
	got := append([]frame(nil), frames...)
	mu.Unlock()
	if len(got) == 0 {
		return errors.New("no frames")
	}
	return encode(tmp, slug, got, rect.X, rect.Y, rect.W, show.Seconds)
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
	k := float64(cfg.Width) / width
	even := func(v float64) int { return int(v*k) &^ 1 }
	crop := fmt.Sprintf("crop=%d:%d:%d:%d", even(w), even(w*aspect), even(x), even(y))
	mp4 := filepath.Join(out, slug+".mp4")
	enc := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lp,
		"-vf", crop+",fps=24,format=yuv420p", "-t", fmt.Sprint(seconds),
		"-c:v", "libx264", "-preset", "veryslow", "-crf", "30", "-tune", "animation",
		"-movflags", "+faststart", "-an", mp4)
	enc.Stderr = os.Stderr
	if err := enc.Run(); err != nil {
		return err
	}
	poster := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-frames:v", "1", "-c:v", "libwebp", "-quality", "70", filepath.Join(out, slug+".webp"))
	poster.Stderr = os.Stderr
	return poster.Run()
}
