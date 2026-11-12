package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestGoBuildIsReproducibleFromThePinnedCommit(t *testing.T) {
	if testing.Short() {
		t.Skip("builds a wasm binary")
	}
	dev := t.TempDir()
	t.Setenv("DEV_ROOT", dev)
	repo := filepath.Join(dev, "tiny")
	mkdirAll(t, filepath.Join(repo, "cmd", "webdemo"))
	gitIn(t, repo, "init", "-q")
	writeFile(t, filepath.Join(repo, "go.mod"), []byte("module tiny\n\ngo 1.21\n"))
	main := filepath.Join(repo, "cmd", "webdemo", "main.go")
	writeFile(t, main, []byte("package main\n\nfunc main() { println(\"pinned\") }\n"))
	gitIn(t, repo, "add", "-A")
	gitIn(t, repo, "commit", "-q", "-m", "one")
	d := &Demo{Slug: "test-build-repro", Repo: "tiny", Ref: gitIn(t, repo, "rev-parse", "HEAD"), Pkg: "./cmd/webdemo"}

	out := t.TempDir()
	first := filepath.Join(out, "a.wasm")
	if err := buildTo(d, first, false); err != nil {
		t.Fatal(err)
	}
	writeFile(t, main, []byte("package main\n\nfunc main() { println(\"dirty, uncommitted\") }\n"))
	second := filepath.Join(out, "b.wasm")
	if err := buildTo(d, second, false); err != nil {
		t.Fatal(err)
	}
	a, err := os.ReadFile(first)
	if err != nil || len(a) == 0 {
		t.Fatalf("no binary: %v", err)
	}
	b, err := os.ReadFile(second)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Fatal("a dirty working tree or a second build changed the binary: builds must come from the pinned commit alone")
	}
	if !bytes.Contains(a, []byte("pinned")) {
		t.Fatal("the binary does not hold the pinned commit's code")
	}
	if bytes.Contains(a, []byte("dirty, uncommitted")) {
		t.Fatal("uncommitted code reached the binary")
	}
	if _, err := os.Stat(filepath.Join("/tmp", "crowbett-wasm", d.Slug)); !os.IsNotExist(err) {
		t.Errorf("the export directory was not cleaned up: %v", err)
	}
}

func TestBuildToNeedsAFullRef(t *testing.T) {
	d := &Demo{Slug: "x", Repo: "tiny", Ref: "abc123", Pkg: "./cmd/webdemo"}
	if err := buildTo(d, filepath.Join(t.TempDir(), "x.wasm"), false); err == nil {
		t.Fatal("a short ref was accepted")
	}
}
