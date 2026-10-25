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

// ShareSum is the hash cmd/og records for a card's HTML.
func ShareSum(card []byte) string {
	h := sha256.Sum256(card)
	return hex.EncodeToString(h[:])
}

// checkShareCards fails the build when a card's text or drawing changed
// since its PNG was made, so a shared link never shows a stale claim.
func checkShareCards(cfg Config, s *prepared) error {
	cards, err := s.shareCards()
	if err != nil || cards == nil {
		return err
	}
	b, err := fs.ReadFile(cfg.Src, ShareSums)
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
	for name, card := range cards {
		if recorded[name] != ShareSum(card) {
			stale = append(stale, name)
		}
	}
	if len(stale) > 0 {
		slices.Sort(stale)
		return fmt.Errorf("share images out of date for %s: run `go run ./cmd/og` (needs Chrome) and commit web/og", strings.Join(stale, ", "))
	}
	return nil
}
