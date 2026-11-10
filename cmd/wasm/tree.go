package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// A tree says where every byte of a published binary goes: the binary, then
// whose code it is (own, dependencies, standard library, runtime), then
// package or module path, then function, with data and module structure
// beside the code. Every node's bytes are the sum of its children's, and the
// root's are the file's. Names come from a twin build of the same commit that
// keeps them; trees refuses a twin whose code section differs from the
// published binary's by one byte.

const (
	treeDir     = "web/bytes"
	maxChildren = 40
	maxLabel    = 120
)

// Node is one level. I is set on functions only: the index the code section
// and a disassembler use. O sums the children cut by maxChildren.
type Node struct {
	N string  `json:"n"`
	B int     `json:"b"`
	F int     `json:"f,omitempty"`
	I *int    `json:"i,omitempty"`
	K []*Node `json:"k,omitempty"`
	O *Rest   `json:"o,omitempty"`

	kids map[string]*Node
	fn   bool
}

// Rest is what a node's cut children add up to.
type Rest struct {
	C int `json:"c"`
	F int `json:"f"`
	B int `json:"b"`
}

// Tree is one web/bytes/<slug>.json.
type Tree struct {
	Slug   string `json:"slug"`
	Kind   string `json:"kind"`
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
	Root   *Node  `json:"tree"`
}

// Origins, in the order a tree lists them.
const (
	oOwn       = "Own code"
	oDeps      = "Dependencies"
	oStd       = "Standard library"
	oRuntime   = "Go runtime"
	oData      = "Data"
	oStructure = "Module structure"
)

var ownOf = map[string][]string{} // slug -> own Go modules or Rust crates, read from the pinned source

func trees(lock *Lock, only []string) error {
	if err := os.MkdirAll(treeDir, 0o755); err != nil {
		return err
	}
	for i := range lock.Demos {
		d := lock.Demos[i]
		if len(only) > 0 && !slices.Contains(only, d.Slug) {
			continue
		}
		page, err := os.ReadFile(filepath.Join("content", "projects", d.Slug+".md"))
		if err != nil {
			continue // pipeline smoke tests have no page
		}
		t, err := treeOf(&d, privateSource(page))
		if err != nil {
			return fmt.Errorf("%s: %w", d.Slug, err)
		}
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(treeDir, d.Slug+".json"), append(b, '\n'), 0o644); err != nil {
			return err
		}
		log.Printf("%-10s %8d bytes  %5d functions  tree %6d bytes", d.Slug, t.Bytes, t.Root.F, len(b))
	}
	return nil
}

// privateSource reports whether a project page has no public repo.
func privateSource(page []byte) bool {
	for _, l := range strings.Split(string(page), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(l), "repo:"); ok {
			return strings.TrimSpace(v) == ""
		}
	}
	return true
}

// A private project whose shipped binary carries no names (a stripped Rust
// or C++ build) publishes no more in its tree: its own functions go under
// their index alone, and its type names are cut from the names of library
// code instantiated over them.
const withheld = "names withheld: source is private"

// ownTypes matches a path under any of a project's own crates or namespaces.
func ownTypes(roots []string) *regexp.Regexp {
	if len(roots) == 0 {
		return regexp.MustCompile(`$^`)
	}
	q := make([]string, len(roots))
	for i, r := range roots {
		q[i] = regexp.QuoteMeta(r)
	}
	return regexp.MustCompile(`(^|[^\w:])(?:` + strings.Join(q, "|") + `)(?:::[A-Za-z_]\w*)*`)
}

func treeOf(d *Demo, private bool) (*Tree, error) {
	pub, err := os.ReadFile(filepath.Join("web", "wasm", d.Slug+".wasm"))
	if err != nil {
		return nil, err
	}
	if sum(pub) != d.SHA256 {
		return nil, errors.New("web/wasm binary does not match the lock: run `make wasm` first")
	}
	pm, err := parseModule(pub)
	if err != nil {
		return nil, err
	}
	kind := d.Kind
	if kind == "" {
		kind = "go"
	}
	var names map[int]string
	if kind == "go" {
		if err := buildTo(d, "", true); err != nil { // reads the own modules only
			return nil, err
		}
		names, err = pm.goNames()
	} else {
		names, err = twinNames(d, pm)
	}
	if err != nil {
		return nil, err
	}
	raw := make([]string, len(pm.bodies))
	for k := range pm.bodies {
		if raw[k] = names[pm.imports+k]; raw[k] == "" {
			raw[k] = fmt.Sprintf("function %d", pm.imports+k)
		}
	}
	shown := raw
	if kind != "go" {
		if shown, err = demangle(raw); err != nil {
			return nil, err
		}
	}
	root := &Node{N: d.Slug}
	for _, o := range []string{oOwn, oDeps, oStd, oRuntime, oData, oStructure} {
		root.child(o)
	}
	own := ownOf[d.Slug]
	type fn struct {
		origin, leaf string
		path         []string
	}
	fns := make([]fn, len(pm.bodies))
	roots := map[string]bool{}
	for _, c := range own {
		roots[strings.ReplaceAll(c, "-", "_")] = true
	}
	for k := range pm.bodies {
		idx := pm.imports + k
		f := &fns[k]
		f.origin, f.path, f.leaf = classify(kind, shown[k], raw[k] != shown[k], pm.exports[idx], own)
		if f.origin == oOwn && f.path[0] != "exports" && f.path[0] != "global namespace" {
			roots[f.path[0]] = true
		}
	}
	hide := private && kind != "go" && len(pm.names) == 0 // Go keeps its names in pclntab
	scrub := ownTypes(slices.Sorted(maps.Keys(roots)))
	for k, body := range pm.bodies {
		idx := pm.imports + k
		origin, path, leaf := fns[k].origin, fns[k].path, fns[k].leaf
		switch {
		case hide && origin == oOwn && pm.exports[idx] != "":
			path, leaf = []string{"exports"}, pm.exports[idx]
		case hide && origin == oOwn:
			path, leaf = []string{withheld}, fmt.Sprintf("function %d", idx)
		case hide:
			for i := range path {
				path[i] = scrub.ReplaceAllString(path[i], "${1}…")
			}
			leaf = scrub.ReplaceAllString(leaf, "${1}…")
		}
		n := root.child(origin)
		for _, seg := range path {
			n = n.child(clip(seg))
		}
		f := n.leaf(clip(leaf))
		if f.I == nil {
			f.I = &idx
		}
		f.B += body
		f.F++
	}
	data := root.child(oData)
	st := root.child(oStructure)
	st.child("Header").B = 8
	for _, s := range pm.sections {
		switch s.id {
		case 11:
			data.B += s.size
		case 10:
			st.child("Code section header").B += s.size - pm.bodyBytes
		default:
			st.child(s.label()).B += s.size
		}
	}
	root.finish(kind)
	if root.B != len(pub) {
		return nil, fmt.Errorf("tree sums to %d bytes, the binary is %d", root.B, len(pub))
	}
	return &Tree{Slug: d.Slug, Kind: kind, SHA256: d.SHA256, Bytes: len(pub), Root: root}, nil
}

// twinNames builds d again with names kept and takes them from that twin,
// provided its code section is the published binary's, byte for byte.
func twinNames(d *Demo, pm *module) (map[int]string, error) {
	tmp, err := os.MkdirTemp("", "wasm-tree-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	path := filepath.Join(tmp, d.Slug+".wasm")
	if err := buildTo(d, path, true); err != nil {
		return nil, fmt.Errorf("named build: %w", err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	tm, err := parseModule(b)
	if err != nil {
		return nil, fmt.Errorf("named build: %w", err)
	}
	if !bytes.Equal(pm.code, tm.code) {
		return nil, errors.New("the named build's code differs from the published binary's, so its names would not describe it")
	}
	if len(tm.names) == 0 {
		return nil, errors.New("the named build has no name section")
	}
	return tm.names, nil
}

func (n *Node) child(name string) *Node { return n.get(name, name, false) }

// leaf is a function, kept apart from a module of the same name.
func (n *Node) leaf(name string) *Node { return n.get("\x00"+name, name, true) }

func (n *Node) get(key, name string, fn bool) *Node {
	if n.kids == nil {
		n.kids = map[string]*Node{}
	}
	c := n.kids[key]
	if c == nil {
		c = &Node{N: name, fn: fn}
		n.kids[key] = c
	}
	return c
}

// finish sums each node from its children, drops empty ones, sorts largest
// first, joins single-child chains of path segments, and cuts long lists.
func (n *Node) finish(kind string) {
	sep := "::"
	if kind == "go" {
		sep = "/"
	}
	for _, c := range n.kids {
		c.finish(kind)
	}
	if len(n.kids) == 0 {
		return
	}
	n.B, n.F = 0, 0
	for _, c := range n.kids {
		if c.B == 0 {
			continue
		}
		n.K = append(n.K, c)
		n.B += c.B
		n.F += c.F
	}
	sort.SliceStable(n.K, func(a, b int) bool {
		if n.K[a].B != n.K[b].B {
			return n.K[a].B > n.K[b].B
		}
		return n.K[a].N < n.K[b].N
	})
	n.kids = nil
	for _, c := range n.K {
		for len(c.K) == 1 && !c.K[0].fn && c.O == nil && !isOrigin(c.N) {
			only := c.K[0]
			c.N, c.K, c.O = c.N+sep+only.N, only.K, only.O
		}
	}
	if len(n.K) > maxChildren {
		r := &Rest{C: len(n.K) - maxChildren}
		for _, c := range n.K[maxChildren:] {
			r.F += c.F
			r.B += c.B
		}
		n.K, n.O = n.K[:maxChildren], r
	}
}

func isOrigin(s string) bool {
	switch s {
	case oOwn, oDeps, oStd, oRuntime, oData, oStructure:
		return true
	}
	return false
}

func clip(s string) string {
	if r := []rune(s); len(r) > maxLabel {
		return string(r[:maxLabel-1]) + "…"
	}
	return s
}

// classify returns a function's origin, its package or module path and its
// own label.
func classify(kind, name string, mangled bool, exported string, own []string) (string, []string, string) {
	switch kind {
	case "go":
		return classifyGo(name, own)
	case "rust":
		return classifyRust(name, mangled, exported != "", own)
	}
	return classifyCpp(name, exported != "")
}

var goRuntime = []string{"internal/abi", "internal/bytealg", "internal/chacha8rand", "internal/cpu", "internal/goarch", "internal/goos", "internal/stringslite", "internal/sync", "internal/race", "internal/runtime", "runtime", "syscall/js"}

func classifyGo(name string, own []string) (string, []string, string) {
	if strings.HasPrefix(name, "type:") || strings.HasPrefix(name, "go:") {
		return oRuntime, []string{"compiler-generated"}, name
	}
	base := name
	if i := strings.IndexByte(base, '['); i >= 0 {
		base = base[:i]
	}
	slash := strings.LastIndexByte(base, '/')
	dot := strings.IndexByte(base[slash+1:], '.')
	if dot < 0 {
		return oRuntime, []string{"runtime entry points"}, name
	}
	pkg, fn := name[:slash+1+dot], name[slash+1+dot+1:]
	segs := strings.Split(pkg, "/")
	for _, m := range own {
		if pkg == m || strings.HasPrefix(pkg, m+"/") {
			return oOwn, segs, fn
		}
	}
	for _, r := range goRuntime {
		if pkg == r || strings.HasPrefix(pkg, r+"/") {
			return oRuntime, segs, fn
		}
	}
	if strings.Contains(segs[0], ".") {
		return oDeps, segs, fn
	}
	return oStd, segs, fn
}

var rustStd = map[string]bool{"std": true, "core": true, "alloc": true, "compiler_builtins": true, "panic_abort": true, "panic_unwind": true, "dlmalloc": true, "std_detect": true, "unwind": true, "rustc_demangle": true}

func classifyRust(name string, mangled, exported bool, own []string) (string, []string, string) {
	if !mangled {
		if exported {
			return oOwn, []string{"exports"}, name
		}
		return oStd, []string{"unmangled symbols"}, name
	}
	path, leaf := rustPath(name)
	crate := path[0]
	switch {
	case slices.Contains(own, crate):
		return oOwn, path, leaf
	case rustStd[crate]:
		return oStd, path, leaf
	}
	return oDeps, path, leaf
}

// rustPath splits a demangled Rust name into its module path (crate first)
// and the function's own label. "<a::B as c::D>::f" files f under a::B.
func rustPath(name string) ([]string, string) {
	segs := splitTop(name, "::")
	if strings.HasPrefix(segs[0], "<") && strings.HasSuffix(segs[0], ">") {
		inner := segs[0][1 : len(segs[0])-1]
		self, trait, hasTrait := cutTop(inner, " as ")
		ty := strings.TrimRight(strings.TrimLeft(self, "&*[( "), "]) ")
		for _, p := range []string{"mut ", "const ", "dyn "} {
			ty = strings.TrimPrefix(ty, p)
		}
		path := stripGenerics(splitTop(ty, "::"))
		if len(path) < 2 && hasTrait {
			path = append(stripGenerics(splitTop(trait, "::")), "impl for "+self)
		} else if len(path) < 2 {
			path = []string{"core", "primitive " + ty}
		}
		return path, strings.Join(segs[1:], "::")
	}
	fn := len(segs) - 1
	for fn > 0 && (strings.HasPrefix(segs[fn], "<") || strings.HasPrefix(segs[fn], "{")) {
		fn--
	}
	if fn == 0 {
		return []string{segs[0]}, strings.Join(segs, "::")
	}
	return stripGenerics(segs[:fn]), strings.Join(segs[fn:], "::")
}

// classifyCpp reads names wasm-ld already demangled: a C++ name has a
// namespace or a parameter list; a plain one is C, the bridge's exports or
// wasi-libc.
func classifyCpp(name string, exported bool) (string, []string, string) {
	sig := name
	if i := indexTop(sig, "("); i > 0 {
		sig = sig[:i]
	}
	if sig == name && !strings.Contains(name, "::") {
		if exported {
			return oOwn, []string{"exports"}, name
		}
		return oStd, []string{"C library"}, name
	}
	depth, cut := 0, -1 // a template's return type comes first: "void std::sort<...>"
	for i, c := range sig {
		switch {
		case c == '<':
			depth++
		case c == '>' && depth > 0:
			depth--
		case c == ' ' && depth == 0:
			cut = i
		}
	}
	segs := splitTop(sig[cut+1:], "::")
	if len(segs) == 1 {
		return oOwn, []string{"global namespace"}, name
	}
	path := stripGenerics(segs[:len(segs)-1])
	if path[0] == "std" || strings.HasPrefix(path[0], "__") {
		return oStd, path, segs[len(segs)-1]
	}
	return oOwn, path, segs[len(segs)-1]
}

var genericArgs = regexp.MustCompile(`<.*>$`)

func stripGenerics(segs []string) []string {
	out := make([]string, 0, len(segs))
	for _, s := range segs {
		if strings.HasPrefix(s, "<") {
			continue
		}
		if g := genericArgs.ReplaceAllString(s, ""); g != "" {
			s = g
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return []string{"?"}
	}
	return out
}

// splitTop splits s at sep outside <>, (), [] and {}.
func splitTop(s, sep string) []string {
	var out []string
	depth, start := 0, 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '<', '(', '[', '{':
			depth++
		case '>', ')', ']', '}':
			if depth > 0 && (s[i] != '>' || i == 0 || s[i-1] != '-') {
				depth--
			}
		default:
			if depth == 0 && strings.HasPrefix(s[i:], sep) {
				out = append(out, s[start:i])
				i += len(sep) - 1
				start = i + 1
			}
		}
	}
	return append(out, s[start:])
}

func cutTop(s, sep string) (string, string, bool) {
	parts := splitTop(s, sep)
	if len(parts) < 2 {
		return s, "", false
	}
	return parts[0], strings.Join(parts[1:], sep), true
}

func indexTop(s, sub string) int {
	depth := 0
	for i := 0; i < len(s); i++ {
		if depth == 0 && strings.HasPrefix(s[i:], sub) {
			return i
		}
		switch s[i] {
		case '<', '[', '{':
			depth++
		case '>', ']', '}':
			if depth > 0 {
				depth--
			}
		}
	}
	return -1
}

// demangle runs every name through c++filt, which reads Rust v0 and C++.
func demangle(names []string) ([]string, error) {
	cmd := exec.Command("c++filt")
	cmd.Stdin = strings.NewReader(strings.Join(names, "\n") + "\n")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("c++filt: %w", err)
	}
	lines := strings.Split(strings.TrimSuffix(string(out), "\n"), "\n")
	if len(lines) != len(names) {
		return nil, fmt.Errorf("c++filt returned %d names for %d", len(lines), len(names))
	}
	return lines, nil
}

// ownNames records which Go modules or Rust crates in d's pinned source are
// the project's own: its repo's and its siblings' modules, or the path
// packages of the crate's Cargo.lock.
func ownNames(d *Demo, dir string) error {
	switch d.Kind {
	case "cpp":
		return nil
	case "rust":
		crate := filepath.Join(dir, filepath.FromSlash(d.Pkg))
		for p := crate; ; p = filepath.Dir(p) {
			b, err := os.ReadFile(filepath.Join(p, "Cargo.lock"))
			if err == nil {
				ownOf[d.Slug] = pathCrates(string(b))
				return nil
			}
			if p == dir || p == filepath.Dir(p) {
				return errors.New("no Cargo.lock above the crate")
			}
		}
	}
	dirs := []string{dir}
	for _, s := range d.Siblings {
		dirs = append(dirs, filepath.Join(filepath.Dir(dir), filepath.Base(s.Repo)))
	}
	var mods []string
	for _, x := range dirs {
		err := filepath.WalkDir(x, func(p string, e os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if e.IsDir() || e.Name() != "go.mod" {
				return nil
			}
			b, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			for _, l := range strings.Split(string(b), "\n") {
				if m, ok := strings.CutPrefix(strings.TrimSpace(l), "module "); ok {
					mods = append(mods, strings.Trim(strings.TrimSpace(m), `"`))
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	if len(mods) == 0 {
		return errors.New("no go.mod in the pinned source")
	}
	ownOf[d.Slug] = mods
	return nil
}

// pathCrates lists the packages in a Cargo.lock that have no source: the
// workspace's own crates and path dependencies, as symbols spell them.
func pathCrates(lock string) []string {
	var out []string
	for _, pkg := range strings.Split(lock, "[[package]]")[1:] {
		var name string
		sourced := false
		for _, l := range strings.Split(pkg, "\n") {
			if v, ok := strings.CutPrefix(l, "name = "); ok {
				name = strings.Trim(v, `"`)
			}
			if strings.HasPrefix(l, "source = ") {
				sourced = true
			}
		}
		if name != "" && !sourced {
			out = append(out, strings.ReplaceAll(name, "-", "_"))
		}
	}
	return out
}
