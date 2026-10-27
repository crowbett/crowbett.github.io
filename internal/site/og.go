package site

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"slices"
	"strings"
)

// ShareSums is where cmd/og records the hash of each card it screenshotted.
const ShareSums = "web/og/.sums"

// ShareCards renders the share card (template "og") for home and every
// project, keyed by image name ("home", or the project slug). cmd/og
// screenshots them into web/og/<name>.png.
func ShareCards(cfg Config) (map[string][]byte, error) {
	s, err := prepare(cfg)
	if err != nil {
		return nil, err
	}
	return s.shareCards()
}

func (s *prepared) shareCards() (map[string][]byte, error) {
	if s.tmpl.Lookup("og") == nil {
		return nil, nil
	}
	cards := map[string][]byte{}
	render := func(name string, p *Project) error {
		d := s.base
		d.Project = p
		var b bytes.Buffer
		if err := s.tmpl.ExecuteTemplate(&b, "og", d); err != nil {
			return fmt.Errorf("share card %s: %w", name, err)
		}
		cards[name] = b.Bytes()
		return nil
	}
	if err := render("home", nil); err != nil {
		return nil, err
	}
	for i := range s.projects {
		if err := render(s.projects[i].Slug, &s.projects[i]); err != nil {
			return nil, err
		}
	}
	return cards, nil
}

// ShareDeps are the files a share card loads besides its own HTML.
var ShareDeps = []string{"web/assets/site.css", "web/assets/fonts/*.woff2"}

// ImageSum is the hash cmd/og and cmd/dither record for an image screenshotted
// from page, which loads deps (glob patterns in src): a change to either makes
// the image stale.
func ImageSum(src fs.FS, page []byte, deps []string) (string, error) {
	h := sha256.New()
	h.Write(page)
	for _, pat := range deps {
		names, err := fs.Glob(src, pat)
		if err != nil {
			return "", err
		}
		for _, n := range names {
			b, err := fs.ReadFile(src, n)
			if err != nil {
				return "", err
			}
			h.Write([]byte(n))
			h.Write(b)
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// checkShareCards fails the build when a card's text or drawing changed
// since its PNG was made, so a shared link never shows a stale claim.
func checkShareCards(cfg Config, s *prepared) error {
	cards, err := s.shareCards()
	if err != nil || cards == nil {
		return err
	}
	return checkSums(cfg, ShareSums, cards, ShareDeps, "share images", "go run ./cmd/og")
}

// checkSums compares each item's hash with the one recorded in path when its
// image was made, and names the command that remakes the stale ones.
func checkSums(cfg Config, path string, items map[string][]byte, deps []string, what, cmd string) error {
	b, err := fs.ReadFile(cfg.Src, path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	recorded := map[string]string{}
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		if name, sum, ok := strings.Cut(sc.Text(), " "); ok {
			recorded[name] = sum
		}
	}
	var stale []string
	for name, item := range items {
		sum, err := ImageSum(cfg.Src, item, deps)
		if err != nil {
			return err
		}
		if recorded[name] != sum {
			stale = append(stale, name)
		}
	}
	if len(stale) > 0 {
		slices.Sort(stale)
		return fmt.Errorf("%s out of date for %s: run `%s` (needs Chrome) and commit %s", what, strings.Join(stale, ", "), cmd, path[:strings.LastIndex(path, "/")])
	}
	return nil
}
