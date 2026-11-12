package main

import "testing"

func TestULEB(t *testing.T) {
	for _, c := range []struct {
		in []byte
		v  uint64
		n  int
	}{
		{[]byte{0x00}, 0, 1},
		{[]byte{0x7f}, 127, 1},
		{[]byte{0x80, 0x01}, 128, 2},
		{[]byte{0xe5, 0x8e, 0x26}, 624485, 3},
		{[]byte{0x80}, 0, 0},
		{nil, 0, 0},
	} {
		if v, n := uleb(c.in); v != c.v || n != c.n {
			t.Errorf("uleb(%x) = %d,%d want %d,%d", c.in, v, n, c.v, c.n)
		}
	}
}

func TestReaderSignedAndNames(t *testing.T) {
	r := &reader{b: []byte{0x7f, 0xc0, 0xbb, 0x78}}
	if v := r.s(); v != -1 {
		t.Errorf("s() = %d, want -1", v)
	}
	if v := r.s(); v != -123456 {
		t.Errorf("s() = %d, want -123456", v)
	}
	r = &reader{b: []byte{3, 'a', 'b', 'c', 9, 'x'}}
	if n := r.name(); n != "abc" || r.err {
		t.Errorf("name() = %q err=%v", n, r.err)
	}
	if n := r.name(); n != "" || !r.err {
		t.Errorf("overlong name() = %q err=%v, want empty and err", n, r.err)
	}
}

func TestParseModuleRejects(t *testing.T) {
	if _, err := parseModule([]byte("nope")); err == nil {
		t.Error("accepted a non-wasm file")
	}
	if _, err := parseModule([]byte("\x00asm\x01\x00\x00\x00\x01\x05\x00")); err == nil {
		t.Error("accepted a truncated section")
	}
	if _, err := parseModule([]byte("\x00asm\x01\x00\x00\x00")); err != nil {
		t.Errorf("rejected an empty module: %v", err)
	}
}

func TestSectionLabel(t *testing.T) {
	for s, want := range map[section]string{
		{id: 0, name: "name"}: "Custom section name",
		{id: 1}:               "Types",
		{id: 7}:               "Exports",
		{id: 10}:              "Section 10",
	} {
		if got := s.label(); got != want {
			t.Errorf("label(%+v) = %q, want %q", s, got, want)
		}
	}
}

func TestShortAndGzipLen(t *testing.T) {
	for in, want := range map[string]string{"": "worktree", "abc": "abc", "0123456789": "0123456"} {
		if got := short(in); got != want {
			t.Errorf("short(%q) = %q, want %q", in, got, want)
		}
	}
	if n := gzipLen(make([]byte, 4096)); n <= 0 || n >= 4096 {
		t.Errorf("gzipLen of zeros = %d, want compressed", n)
	}
}
