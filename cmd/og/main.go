// Command og screenshots the share cards (templates/og.html) into
// web/og/<name>.png with headless Chrome, records their hashes in
// web/og/.sums for the build's staleness check, and renders the favicon set
// (web/favicon.ico, web/apple-touch-icon.png) from web/assets/icon.svg.
//
//	go run ./cmd/og
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
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
	cfg := site.Config{Src: os.DirFS("."), Owner: site.DefaultOwner, Now: time.Now()}
	cards, err := site.ShareCards(cfg)
	if err != nil {
		return err
	}
	icon, err := os.ReadFile("web/assets/icon.svg")
	if err != nil {
		return err
	}
	// iOS rounds touch icons itself and fills transparency black: square corners.
	touch := strings.Replace(string(icon), ` rx="7"`, "", 1)
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("web")))
	mux.HandleFunc("/og/{name}", func(w http.ResponseWriter, r *http.Request) {
		card, ok := cards[strings.TrimSuffix(r.PathValue("name"), ".html")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(card)
	})
	mux.HandleFunc("/touch.svg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Write([]byte(touch))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancelT := context.WithTimeout(ctx, 2*time.Minute)
	defer cancelT()
	shot := func(url string, w, h int64, transparent bool) ([]byte, error) {
		tab, cancelTab := chromedp.NewContext(ctx)
		defer cancelTab()
		bg := &cdp.RGBA{R: 255, G: 255, B: 255, A: 1}
		if transparent {
			bg = &cdp.RGBA{}
		}
		err := chromedp.Do(tab,
			chromedp.EmulateViewport(w, h),
			chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
				if _, err := cdp.Call(ctx, tg, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "light"}}}); err != nil {
					return err
				}
				_, err := cdp.Call(ctx, tg, emulation.SetDefaultBackgroundColorOverride, emulation.SetDefaultBackgroundColorOverrideParams{Color: bg})
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

	if err := os.MkdirAll("web/og", 0o755); err != nil {
		return err
	}
	names := make([]string, 0, len(cards))
	for name := range cards {
		names = append(names, name)
	}
	slices.Sort(names)
	var sums strings.Builder
	for _, name := range names {
		png, err := shot(srv.URL+"/og/"+name+".html", 1200, 630, false)
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if err := os.WriteFile(filepath.Join("web/og", name+".png"), png, 0o644); err != nil {
			return err
		}
		fmt.Fprintf(&sums, "%s %s\n", name, site.ShareSum(cards[name]))
		fmt.Printf("web/og/%s.png %d bytes\n", name, len(png))
	}
	if err := os.WriteFile(site.ShareSums, []byte(sums.String()), 0o644); err != nil {
		return err
	}

	apple, err := shot(srv.URL+"/touch.svg", 180, 180, false)
	if err != nil {
		return err
	}
	if err := os.WriteFile("web/apple-touch-icon.png", apple, 0o644); err != nil {
		return err
	}
	small, err := shot(srv.URL+"/assets/icon.svg", 32, 32, true)
	if err != nil {
		return err
	}
	if err := os.WriteFile("web/favicon.ico", ico(small, 32), 0o644); err != nil {
		return err
	}
	fmt.Println("web/apple-touch-icon.png, web/favicon.ico")
	return nil
}

// ico wraps one PNG in an ICO container (Windows Vista+ and every browser read PNG entries).
func ico(png []byte, size uint8) []byte {
	var b bytes.Buffer
	binary.Write(&b, binary.LittleEndian, struct {
		Reserved, Type, Count   uint16
		W, H, Colors, Reserved2 uint8
		Planes, BPP             uint16
		Size, Offset            uint32
	}{0, 1, 1, size, size, 0, 0, 1, 32, uint32(len(png)), 22})
	b.Write(png)
	return b.Bytes()
}
