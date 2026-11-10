package main

import (
	"slices"
	"strings"
	"testing"
)

func TestClassify(t *testing.T) {
	for _, c := range []struct {
		kind, name, exported string
		own                  []string
		origin, path, leaf   string
	}{
		{"go", "github.com/crowbett/kvlite/internal/segment.parseHint", "", []string{"github.com/crowbett/kvlite"}, oOwn, "github.com/crowbett/kvlite/internal/segment", "parseHint"},
		{"go", "strings.(*Builder).Grow", "", nil, oStd, "strings", "(*Builder).Grow"},
		{"go", "golang.org/x/net/http2.(*Framer).ReadFrame", "", nil, oDeps, "golang.org/x/net/http2", "(*Framer).ReadFrame"},
		{"go", "runtime.mallocgc", "", nil, oRuntime, "runtime", "mallocgc"},
		{"go", "internal/runtime/maps.(*Map).getWithKey", "", nil, oRuntime, "internal/runtime/maps", "(*Map).getWithKey"},
		{"go", "type:.eq.[2]string", "", nil, oRuntime, "compiler-generated", "type:.eq.[2]string"},
		{"go", "_rt0_wasm_js", "", nil, oRuntime, "runtime entry points", "_rt0_wasm_js"},
		{"rust", "<keel::sql::Parser as core::fmt::Debug>::fmt", "", []string{"keel"}, oOwn, "keel/sql/Parser", "fmt"},
		{"rust", "<&str as core::fmt::Display>::fmt", "", nil, oStd, "core/fmt/Display/impl for &str", "fmt"},
		{"rust", "<[u8] as alloc::slice::SpecCloneIntoVec>::clone_into", "", nil, oStd, "alloc/slice/SpecCloneIntoVec/impl for [u8]", "clone_into"},
		{"rust", "alloc::vec::Vec<u8>::push", "", nil, oStd, "alloc/vec/Vec", "push"},
		{"rust", "serde_json::de::from_str", "", nil, oDeps, "serde_json/de", "from_str"},
		{"rust", "run", "run", nil, oOwn, "exports", "run"},
		{"cpp", "std::__2::vector<int>::push_back(int const&)", "", nil, oStd, "std/__2/vector", "push_back"},
		{"cpp", "void std::__2::sort<int*>(int*, int*)", "", nil, oStd, "std/__2", "sort<int*>"},
		{"cpp", "rt::Camera::ray(float, float) const", "", nil, oOwn, "rt/Camera", "ray"},
		{"cpp", "malloc", "", nil, oStd, "C library", "malloc"},
		{"cpp", "render", "render", nil, oOwn, "exports", "render"},
	} {
		mangled := c.kind == "rust" && c.exported == ""
		origin, path, leaf := classify(c.kind, c.name, mangled, c.exported, c.own)
		if got := strings.Join(path, "/"); origin != c.origin || got != c.path || leaf != c.leaf {
			t.Errorf("%s %q: got %s / %s / %s, want %s / %s / %s", c.kind, c.name, origin, got, leaf, c.origin, c.path, c.leaf)
		}
	}
}

func TestFinishAddsUp(t *testing.T) {
	root := &Node{N: "x"}
	for i := range maxChildren + 5 {
		fn := root.child(oOwn).child("pkg").leaf(strings.Repeat("f", i+1))
		fn.B, fn.F = i+1, 1
	}
	root.finish("go")
	own := root.K[0]
	if own.N != oOwn || own.B != (maxChildren+5)*(maxChildren+6)/2 || own.F != maxChildren+5 {
		t.Fatalf("own code: %s %d bytes %d functions", own.N, own.B, own.F)
	}
	pkg := own.K[0]
	if len(pkg.K) != maxChildren || pkg.O == nil || pkg.O.C != 5 {
		t.Fatalf("pkg keeps %d children, rest %+v", len(pkg.K), pkg.O)
	}
	if !slices.IsSortedFunc(pkg.K, func(a, b *Node) int { return b.B - a.B }) {
		t.Fatal("children are not largest first")
	}
}

func TestWithheld(t *testing.T) {
	re := ownTypes([]string{"keel_raft", "rt"})
	got := re.ReplaceAllString("VacantEntry<u64, keel_raft::node::Pending<u8>>::insert, start::rt, rt::Hit*", "${1}…")
	if want := "VacantEntry<u64, …<u8>>::insert, start::rt, …*"; got != want {
		t.Errorf("scrub: got %q, want %q", got, want)
	}
	if ownTypes(nil).MatchString("anything") {
		t.Error("no roots matched a name")
	}
	for page, want := range map[string]bool{"---\nrepo:\n---": true, "---\nrepo: https://github.com/crowbett/kvlite\n---": false, "---\ntitle: x\n---": true} {
		if privateSource([]byte(page)) != want {
			t.Errorf("privateSource(%q) = %v", page, !want)
		}
	}
}
