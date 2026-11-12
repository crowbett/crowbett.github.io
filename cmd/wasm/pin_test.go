package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@t"}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestLockRoundTrip(t *testing.T) {
	t.Chdir(t.TempDir())
	want := &Lock{Go: "go1.27.0", WasmExecSHA256: "ab", Demos: []Demo{{Slug: "x", Repo: ".", Pkg: "./cmd/webdemo", SHA256: "cd", Bytes: 5, Gzip: 3}}}
	if err := writeLock(want); err != nil {
		t.Fatal(err)
	}
	got, err := readLock()
	if err != nil || got.Go != want.Go || len(got.Demos) != 1 || got.Demos[0].SHA256 != want.Demos[0].SHA256 || got.Demos[0].Bytes != 5 {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	if err := os.WriteFile(lockFile, []byte(`{"go":"g","surprise":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readLock(); err == nil {
		t.Fatal("readLock must reject unknown fields")
	}
}

func TestPin(t *testing.T) {
	dev := t.TempDir()
	t.Setenv("DEV_ROOT", dev)
	t.Chdir(t.TempDir())
	repo := filepath.Join(dev, "proj")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	gitIn(t, repo, "init", "-q")
	gitIn(t, repo, "commit", "-q", "--allow-empty", "-m", "c")
	head := gitIn(t, repo, "rev-parse", "HEAD")
	lock := &Lock{Demos: []Demo{{Slug: "x", Repo: "proj"}}}

	if err := pin(lock, "nope", "HEAD", true); err == nil {
		t.Error("pinned an unknown slug")
	}
	if err := pin(lock, "x", "HEAD", false); err == nil || !strings.Contains(err.Error(), "no remote branch") {
		t.Errorf("unpushed commit pinned without allowUnpushed: %v", err)
	}
	if err := pin(lock, "x", "HEAD", true); err != nil {
		t.Fatal(err)
	}
	if lock.Demos[0].Ref != head {
		t.Errorf("Ref = %q, want %q", lock.Demos[0].Ref, head)
	}
	if l, err := readLock(); err != nil || l.Demos[0].Ref != head {
		t.Errorf("pin did not write the lock: %v", err)
	}
}
