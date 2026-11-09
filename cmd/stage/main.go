// Command stage renders the home stage's poster: headless Chrome opens the
// home page from a fresh build, lets the raytracer demo's real build trace
// site.HomeStage to PosterSpp samples per pixel, and saves the split picture
// as web/reel/stage.webp. web/reel/.stage ties it to the pinned binary and
// the stage parameters so the build fails when it goes stale.
//
//	go run ./cmd/stage
package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}
	tmp, err := os.MkdirTemp("", "stage")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	dist := filepath.Join(tmp, "dist")
	cfg := site.Config{Src: os.DirFS("."), Out: dist, Owner: site.DefaultOwner, Now: time.Now(), Recording: true}
	if err := site.Build(cfg); err != nil {
		return err
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(dist)))
	defer srv.Close()

	opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.DisableGPU)
	actx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer cancel()
	ctx, cancel := chromedp.NewContext(actx)
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	s := site.HomeStage
	err = chromedp.Do(ctx,
		chromedp.EmulateViewport(1280, 900),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
				Features: []*emulation.MediaFeature{{Name: "prefers-reduced-motion", Value: "reduce"}},
			})
			return err
		}),
		chromedp.Navigate(srv.URL+"/"),
	)
	if err != nil {
		return err
	}
	start := fmt.Sprintf(`(f => { f.dataset.max = %d; f.querySelector("[data-run]").click(); return true; })(document.querySelector("[data-stage]"))`, s.PosterSpp)
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](start)); err != nil {
		return err
	}
	began := time.Now()
	done := fmt.Sprintf(`(f => !("running" in f.dataset) && f.querySelector("[data-k=spp]").textContent === "%d")(document.querySelector("[data-stage]"))`, s.PosterSpp)
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](done, chromedp.WithPollingTimeout(4*time.Minute))); err != nil {
		return fmt.Errorf("render to %d spp: %w", s.PosterSpp, err)
	}
	png, err := chromedp.Run(ctx, chromedp.Evaluate[string](`(() => {
		const v = document.querySelector(".stage-view");
		const [r, l] = [v.querySelector(".stage-r"), v.querySelector(".stage-l")];
		const c = document.createElement("canvas");
		c.width = r.width;
		c.height = r.height;
		const x = c.getContext("2d");
		x.drawImage(r, 0, 0);
		x.drawImage(l, 0, 0, l.width / 2, l.height, 0, 0, l.width / 2, l.height);
		return c.toDataURL("image/png").split(",")[1];
	})()`))
	if err != nil {
		return err
	}
	b, err := base64.StdEncoding.DecodeString(png)
	if err != nil {
		return err
	}
	src := filepath.Join(tmp, "stage.png")
	if err := os.WriteFile(src, b, 0o644); err != nil {
		return err
	}
	enc := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-i", src, "-c:v", "libwebp", "-quality", "82", site.StagePoster)
	enc.Stderr = os.Stderr
	if err := enc.Run(); err != nil {
		return err
	}
	item, err := site.StageSource(os.DirFS("."))
	if err != nil {
		return err
	}
	sum, err := site.ImageSum(os.DirFS("."), item, nil)
	if err != nil {
		return err
	}
	if err := os.WriteFile(site.StageSums, []byte("stage "+sum+"\n"), 0o644); err != nil {
		return err
	}
	fi, err := os.Stat(site.StagePoster)
	if err != nil {
		return err
	}
	log.Printf("%s: %d spp in %v, %d B", strings.TrimPrefix(site.StagePoster, "web/"), s.PosterSpp, time.Since(began).Round(time.Millisecond), fi.Size())
	return nil
}
