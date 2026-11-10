package site

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"slices"
)

// TreeDir holds one tree per live demo, written by `go run ./cmd/wasm tree`:
// where every byte of its binary goes, down to each function. The numbers
// page renders the levels above the binaries and levels.js fetches the rest.
const TreeDir = "web/bytes"

// ByteNode is one level of a tree. Its bytes are its children's plus the
// ones cut from the list (O); I is a function's index in the binary.
type ByteNode struct {
	N string     `json:"n"`
	B int        `json:"b"`
	F int        `json:"f"`
	I *int       `json:"i"`
	K []ByteNode `json:"k"`
	O *struct {
		C int `json:"c"`
		F int `json:"f"`
		B int `json:"b"`
	} `json:"o"`
}

// ByteTree is one web/bytes/<slug>.json.
type ByteTree struct {
	Slug   string   `json:"slug"`
	Kind   string   `json:"kind"`
	SHA256 string   `json:"sha256"`
	Bytes  int      `json:"bytes"`
	Root   ByteNode `json:"tree"`
}

// levels is the top of the numbers page's tree: every binary, by language.
type levels struct {
	Bytes, Funcs, Count    int
	Langs                  []langLevel
	LightestGz, HeaviestGz string // slugs of the smallest and largest binary after gzip
}

type langLevel struct {
	Name, Kind   string
	Note         string // "3 binaries"
	Bytes, Funcs int
	Share, Pct   string
	Bins         []binLevel
}

type binLevel struct {
	Slug, Title, Built string
	Bytes, Funcs, Gzip int
	Share, Pct         string
}

// loadTree reads slug's tree and fails unless it describes the binary the
// lock pins, byte for byte, and every level adds up to the one above it.
func loadTree(src fs.FS, slug string, d demoSize) (*ByteTree, error) {
	fix := fmt.Sprintf("run `go run ./cmd/wasm tree %s` and commit %s", slug, TreeDir)
	b, err := fs.ReadFile(src, TreeDir+"/"+slug+".json")
	if err != nil {
		return nil, fmt.Errorf("%s: no byte tree: %s", slug, fix)
	}
	if bad := Unpublishable(string(b)); bad != "" {
		return nil, fmt.Errorf("%s: byte tree: %s", slug, bad)
	}
	var t ByteTree
	if err := json.Unmarshal(b, &t); err != nil {
		return nil, fmt.Errorf("%s: byte tree: %w", slug, err)
	}
	if t.SHA256 != d.Full || t.Bytes != d.Raw || t.Root.B != d.Raw {
		return nil, fmt.Errorf("%s: byte tree is for another build of the binary: %s", slug, fix)
	}
	if err := t.Root.check(); err != nil {
		return nil, fmt.Errorf("%s: byte tree: %w", slug, err)
	}
	return &t, nil
}

func (n ByteNode) check() error {
	if len(n.K) == 0 {
		return nil
	}
	b, f := 0, 0
	if n.O != nil {
		b, f = n.O.B, n.O.F
	}
	for _, c := range n.K {
		if err := c.check(); err != nil {
			return err
		}
		b += c.B
		f += c.F
	}
	if b != n.B || f != n.F {
		return fmt.Errorf("%q holds %d bytes in %d functions but its levels add up to %d in %d", n.N, n.B, n.F, b, f)
	}
	return nil
}

// binTree is a project page's levels: its binary and the origins under it.
type binTree struct {
	binLevel
	Kind    string
	Origins []originLevel
}

type originLevel struct {
	Name         string
	Bytes, Funcs int
	Share, Pct   string
	Opens        bool // has a level below
}

func treeTop(t *ByteTree, b binLevel) *binTree {
	bt := &binTree{binLevel: b, Kind: t.Kind}
	for _, o := range t.Root.K {
		s, p := share(o.B, t.Root.B)
		bt.Origins = append(bt.Origins, originLevel{Name: o.N, Bytes: o.B, Funcs: o.F, Share: s, Pct: p, Opens: len(o.K) > 0 || o.O != nil})
	}
	return bt
}

var langName = map[string]string{"go": "Go", "rust": "Rust", "cpp": "C++"}

// buildLevels groups the live demos' trees by language, largest first.
func buildLevels(bins []binLevel, kinds []string) *levels {
	lv := &levels{Count: len(bins), LightestGz: bins[0].Slug, HeaviestGz: bins[0].Slug}
	gz := map[string]int{}
	for i, b := range bins {
		gz[b.Slug] = b.Gzip
		if b.Gzip < gz[lv.LightestGz] {
			lv.LightestGz = b.Slug
		}
		if b.Gzip > gz[lv.HeaviestGz] {
			lv.HeaviestGz = b.Slug
		}
		k := kinds[i]
		j := slices.IndexFunc(lv.Langs, func(l langLevel) bool { return l.Kind == k })
		if j < 0 {
			lv.Langs = append(lv.Langs, langLevel{Name: langName[k], Kind: k})
			j = len(lv.Langs) - 1
		}
		l := &lv.Langs[j]
		l.Bins = append(l.Bins, b)
		l.Bytes += b.Bytes
		l.Funcs += b.Funcs
		lv.Bytes += b.Bytes
		lv.Funcs += b.Funcs
	}
	slices.SortStableFunc(lv.Langs, func(a, b langLevel) int { return b.Bytes - a.Bytes })
	for i := range lv.Langs {
		l := &lv.Langs[i]
		l.Share, l.Pct = share(l.Bytes, lv.Bytes)
		l.Note = fmt.Sprintf("%d binaries", len(l.Bins))
		if len(l.Bins) == 1 {
			l.Note = "1 binary"
		}
		slices.SortStableFunc(l.Bins, func(a, b binLevel) int { return b.Bytes - a.Bytes })
		for j := range l.Bins {
			l.Bins[j].Share, l.Bins[j].Pct = share(l.Bins[j].Bytes, l.Bytes)
		}
	}
	return lv
}

// share is part's share of whole as the page writes it, and as a bar length.
func share(part, whole int) (string, string) {
	f := float64(part) / float64(whole)
	text := fmt.Sprintf("%.1f%%", 100*f)
	if f > 0 && f < 0.001 {
		text = "<0.1%"
	}
	return text, fmt.Sprintf("%.2f", 100*f)
}
