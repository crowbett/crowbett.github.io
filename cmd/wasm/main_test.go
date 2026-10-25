package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckDetectsDrift(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.MkdirAll("web/wasm", 0o755); err != nil {
		t.Fatal(err)
	}
	bin, js := []byte("\x00asm binary"), []byte("// wasm_exec")
	os.WriteFile(filepath.Join("web", "wasm", "a.wasm"), bin, 0o644)
	os.WriteFile(filepath.Join("web", "wasm", "wasm_exec.js"), js, 0o644)
	lock := &Lock{Go: "go1.27.0", WasmExecSHA256: sum(js), Demos: []Demo{{Slug: "a", Repo: ".", SHA256: sum(bin)}}}
	if err := check(lock); err != nil {
		t.Fatalf("matching binaries failed the check: %v", err)
	}
	os.WriteFile(filepath.Join("web", "wasm", "a.wasm"), []byte("changed"), 0o644)
	os.WriteFile(filepath.Join("web", "wasm", "stray.wasm"), bin, 0o644)
	lock.Demos = append(lock.Demos, Demo{Slug: "gone", Repo: "."})
	err := check(lock)
	if err == nil || !strings.Contains(err.Error(), "a: binary does not match") || !strings.Contains(err.Error(), "gone:") || !strings.Contains(err.Error(), "stray.wasm is not in the lock") {
		t.Fatalf("want drift, missing and stray-file errors, got %v", err)
	}
}

func TestBuildRequiresPinnedRef(t *testing.T) {
	d := &Demo{Slug: "x", Repo: "quorum", Ref: "main", Pkg: "./cmd/webdemo"}
	if err := buildOne(d); err == nil || !strings.Contains(err.Error(), "full commit SHA") {
		t.Fatalf("want pin error, got %v", err)
	}
}

func TestBuildRejectsUnknownKind(t *testing.T) {
	d := &Demo{Slug: "x", Kind: "zig", Repo: ".", Pkg: "./wasm/x"}
	if err := buildOne(d); err == nil || !strings.Contains(err.Error(), `unknown kind "zig"`) {
		t.Fatalf("want kind error, got %v", err)
	}
}

func TestExportDirIsFixedAndEmpty(t *testing.T) {
	slug := "test-" + filepath.Base(t.TempDir())
	dir, unlock, err := exportDir(slug)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "left"), nil, 0o644)
	unlock()
	again, unlock, err := exportDir(slug)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(filepath.Join(filepath.Dir(again), slug+".lock"))
	defer unlock()
	if again != dir {
		t.Fatalf("export dir moved: %s then %s", dir, again)
	}
	if entries, _ := os.ReadDir(again); len(entries) != 0 {
		t.Fatalf("export dir not empty: %v", entries)
	}
}
