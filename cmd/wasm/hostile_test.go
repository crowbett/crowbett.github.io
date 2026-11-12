package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseModuleCorruptCountsFailFast(t *testing.T) {
	huge := []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0x7f}
	for _, id := range []byte{2, 7, 10, 11} {
		mod := append([]byte("\x00asm\x01\x00\x00\x00"), wasmSection(id, huge)...)
		done := make(chan error, 1)
		go func() { _, err := parseModule(mod); done <- err }()
		select {
		case err := <-done:
			if err == nil {
				t.Errorf("section %d: a count larger than the section was accepted", id)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("section %d: parseModule spins on a corrupt count", id)
		}
	}
}

func TestParseModuleReadsEveryPublishedBinary(t *testing.T) {
	files, err := filepath.Glob("../../web/wasm/*.wasm")
	if err != nil || len(files) == 0 {
		t.Fatalf("no published binaries found: %v", err)
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		m, err := parseModule(b)
		if err != nil {
			t.Errorf("%s: %v", filepath.Base(f), err)
			continue
		}
		if len(m.bodies) == 0 || len(m.exports) == 0 {
			t.Errorf("%s: parsed %d bodies and %d exports", filepath.Base(f), len(m.bodies), len(m.exports))
		}
	}
}

func FuzzParseModule(f *testing.F) {
	header := []byte("\x00asm\x01\x00\x00\x00")
	f.Add(header)
	f.Add([]byte("\x00asm\x01\x00\x00\x00\x02\v\x04\xd5\xd5\xd5\xd5\xd5\xd5\xd5\xd5\xd51")) // a length that wraps negative as an int
	f.Add(append(append([]byte{}, header...), wasmSection(7, []byte{1}, wasmStr("main"), []byte{0, 0})...))
	f.Add(append(append([]byte{}, header...), wasmSection(0, wasmStr("name"), []byte{1, 5, 1, 0}, wasmStr("f"))...))
	if b, err := os.ReadFile("../../web/wasm/kvlite.wasm"); err == nil {
		f.Add(b[:min(len(b), 4096)])
	}
	f.Fuzz(func(t *testing.T, b []byte) {
		m, err := parseModule(b)
		if err == nil && m == nil {
			t.Fatal("no module and no error")
		}
	})
}
