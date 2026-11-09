// Command dither turns each project's diagram (templates/diagrams.html) into
// 1-bit mask sprites: headless Chrome renders the sheet from templates/dither.html,
// an 8x8 Bayer matrix dithers it, and oxipng packs the result into
// web/assets/dg/<slug>-<size>.png. site.css draws them as CSS masks, so they
// take the theme's colours. Hashes go to web/assets/dg/.sums for the build's
// staleness check.
//
//	go run ./cmd/dither
package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"
	"github.com/makeworld-the-better-one/dither/v2"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

const out = "web/assets/dg"

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	if _, err := exec.LookPath("oxipng"); err != nil {
		return fmt.Errorf("oxipng not found (brew install oxipng): %w", err)
	}
	cfg := site.Config{Src: os.DirFS("."), Owner: site.DefaultOwner, Now: time.Now()}
	sheets, err := site.MaskSheets(cfg)
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("web")))
	mux.HandleFunc("/sheet/{name}", func(w http.ResponseWriter, r *http.Request) {
		sheet, ok := sheets[r.PathValue("name")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(sheet)
		w.Write([]byte(passCSS[r.URL.Query().Get("pass")]))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancelT := context.WithTimeout(ctx, 2*time.Minute)
	defer cancelT()

	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	bayer := dither.NewDitherer([]color.Color{color.Black, color.White})
	bayer.Mapper = dither.Bayer(8, 8, 1.0)

	names := make([]string, 0, len(sheets))
	for name := range sheets {
		names = append(names, name)
	}
	slices.Sort(names)
	var sums strings.Builder
	var files []string
	for _, name := range names {
		size := sizeOf(name)
		shoot := func(pass string, scale float64) (image.Image, error) {
			shot, err := screenshot(ctx, srv.URL+"/sheet/"+name+"?pass="+pass, int64(2*size.W), int64(2*size.H), scale)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", name, err)
			}
			return png.Decode(bytes.NewReader(shot))
		}
		art, err := shoot("art", 1)
		if err != nil {
			return err
		}
		mask := toMask(art, bayer.DitherPaletted(art))
		if size.Labels {
			labels, err := shoot("labels", 2)
			if err != nil {
				return err
			}
			mask = double(mask)
			addLabels(mask, labels)
		}
		file := filepath.Join(out, name+".png")
		var b bytes.Buffer
		if err := png.Encode(&b, mask); err != nil {
			return err
		}
		if err := os.WriteFile(file, b.Bytes(), 0o644); err != nil {
			return err
		}
		files = append(files, file)
		sum, err := site.ImageSum(cfg.Src, sheets[name], site.MaskDeps)
		if err != nil {
			return err
		}
		fmt.Fprintf(&sums, "%s %s\n", name, sum)
	}
	cmd := exec.Command("oxipng", append([]string{"-q", "-o", "max", "--strip", "all"}, files...)...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("oxipng: %w", err)
	}
	total := 0
	for _, f := range files {
		st, err := os.Stat(f)
		if err != nil {
			return err
		}
		total += int(st.Size())
	}
	fmt.Printf("%d masks in %s, %d bytes\n", len(files), out, total)
	return os.WriteFile(site.MaskSums, []byte(sums.String()), 0o644)
}

// passCSS splits a sheet into the drawing and its labels. 7 px glyphs are
// unreadable at one mask pixel per CSS pixel ("redis" came out "eedis"), so a
// labelled mask is twice the size: the dithered drawing scaled up 2x, and its
// labels drawn at 2x, antialiased and thresholded. On a 2x screen they are
// crisp; the dither keeps its chunky one-CSS-pixel grain.
var passCSS = map[string]string{
	"art":    `<style>.dg .t { display: none !important; }</style>`,
	"labels": `<style>html, body { -webkit-font-smoothing: antialiased !important; } .dg :not(.t, g, text, tspan) { fill: transparent !important; stroke: transparent !important; }</style>`,
}

// double scales a mask up 2x, nearest neighbour.
func double(m *image.Paletted) *image.Paletted {
	b := m.Bounds()
	d := image.NewPaletted(image.Rect(0, 0, 2*b.Dx(), 2*b.Dy()), m.Palette)
	for y := range d.Rect.Dy() {
		for x := range d.Rect.Dx() {
			d.Pix[d.PixOffset(x, y)] = m.Pix[m.PixOffset(b.Min.X+x/2, b.Min.Y+y/2)]
		}
	}
	return d
}

// addLabels sets every pixel the label pass drew darker than mid-grey.
func addLabels(m *image.Paletted, labels image.Image) {
	b := m.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if color.GrayModel.Convert(labels.At(x, y)).(color.Gray).Y < 128 {
				m.Pix[m.PixOffset(x, y)] = 1
			}
		}
	}
}

func sizeOf(name string) site.MaskSize {
	for _, m := range site.MaskSizes {
		if strings.HasSuffix(name, "-"+m.Name) {
			return m
		}
	}
	panic("no mask size for " + name)
}

func screenshot(ctx context.Context, url string, w, h int64, scale float64) ([]byte, error) {
	tab, cancel := chromedp.NewContext(ctx)
	defer cancel()
	err := chromedp.Do(tab,
		chromedp.EmulateViewport(w, h, chromedp.EmulateScale(scale)),
		chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
			if _, err := cdp.Call(ctx, tg, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "light"}}}); err != nil {
				return err
			}
			_, err := cdp.Call(ctx, tg, emulation.SetDefaultBackgroundColorOverride, emulation.SetDefaultBackgroundColorOverrideParams{Color: &cdp.RGBA{R: 255, G: 255, B: 255, A: 1}})
			return err
		}),
		chromedp.Navigate(url))
	if err != nil {
		return nil, err
	}
	if _, err := chromedp.Run(tab, chromedp.Evaluate[bool](`document.fonts.ready.then(() => true)`, chromedp.EvalAwaitPromise)); err != nil {
		return nil, err
	}
	return chromedp.Run(tab, chromedp.CaptureScreenshot())
}

// toMask maps black to opaque and white to transparent in a two-entry palette,
// which image/png writes as a 1-bit PNG. Greys within one matrix step (255/64)
// of either end stay solid: at full strength the matrix's extreme cells would
// otherwise punch holes in black and speckle white.
func toMask(src image.Image, p *image.Paletted) *image.Paletted {
	m := image.NewPaletted(p.Bounds(), color.Palette{color.NRGBA{}, color.NRGBA{A: 255}})
	black := uint8(p.Palette.Index(color.Black))
	b := p.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			i := p.PixOffset(x, y)
			switch g := color.GrayModel.Convert(src.At(x, y)).(color.Gray).Y; {
			case g < 4:
				m.Pix[i] = 1
			case g <= 251 && p.Pix[i] == black:
				m.Pix[i] = 1
			}
		}
	}
	return m
}
