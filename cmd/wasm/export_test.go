package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportIsCommittedFilesAtTheRef(t *testing.T) {
	dev := t.TempDir()
	t.Setenv("DEV_ROOT", dev)
	repo := filepath.Join(dev, "proj")
	mkdirAll(t, filepath.Join(repo, "cmd", "webdemo"))
	gitIn(t, repo, "init", "-q")
	writeFile(t, filepath.Join(repo, "cmd", "webdemo", "main.go"), []byte("package main // v1\n"))
	writeFile(t, filepath.Join(repo, "go.mod"), []byte("module x\n"))
	gitIn(t, repo, "add", "-A")
	gitIn(t, repo, "commit", "-q", "-m", "one")
	ref := gitIn(t, repo, "rev-parse", "HEAD")

	writeFile(t, filepath.Join(repo, "cmd", "webdemo", "main.go"), []byte("package main // v2 committed later\n"))
	gitIn(t, repo, "commit", "-q", "-am", "two")
	writeFile(t, filepath.Join(repo, "scratch.txt"), []byte("untracked"))

	dst := t.TempDir()
	if err := export(Dep{Repo: "proj", Ref: ref}, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dst, "cmd", "webdemo", "main.go"))
	if err != nil || !strings.Contains(string(got), "v1") || strings.Contains(string(got), "v2") {
		t.Fatalf("export is not the pinned commit: %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(dst, "go.mod")); err != nil {
		t.Errorf("tracked file missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "scratch.txt")); err == nil {
		t.Error("an untracked file leaked into the export")
	}
}

func TestExportRejectsUnknownRef(t *testing.T) {
	dev := t.TempDir()
	t.Setenv("DEV_ROOT", dev)
	repo := filepath.Join(dev, "proj")
	mkdirAll(t, repo)
	gitIn(t, repo, "init", "-q")
	gitIn(t, repo, "commit", "-q", "--allow-empty", "-m", "c")
	err := export(Dep{Repo: "proj", Ref: strings.Repeat("0", 40)}, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "git archive proj@0000000") {
		t.Fatalf("unknown ref: %v", err)
	}
}
