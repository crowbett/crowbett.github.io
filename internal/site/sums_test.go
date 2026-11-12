package site

import (
	"strings"
	"testing"
	"testing/fstest"
)

func TestCheckSums(t *testing.T) {
	items := map[string][]byte{"b": []byte("page b"), "a": []byte("page a")}
	sum := func(name string) string {
		s, err := ImageSum(fstest.MapFS{}, items[name], nil)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	run := func(sums string) error {
		src := fstest.MapFS{}
		if sums != "" {
			src["web/x/.sums"] = &fstest.MapFile{Data: []byte(sums)}
		}
		return checkSums(Config{Src: src}, "web/x/.sums", items, nil, "pictures", "go run ./cmd/x")
	}

	if err := run("a " + sum("a") + "\nb " + sum("b") + "\n"); err != nil {
		t.Fatalf("matching sums rejected: %v", err)
	}
	err := run("a " + sum("a") + "\nb stale\n")
	if err == nil || !strings.Contains(err.Error(), "out of date for b:") || strings.Contains(err.Error(), "for a") {
		t.Fatalf("want only b stale, got %v", err)
	}
	err = run("")
	if err == nil || !strings.Contains(err.Error(), "out of date for a, b:") {
		t.Fatalf("a missing sums file must mark every item stale, sorted: %v", err)
	}
	if !strings.Contains(err.Error(), "`go run ./cmd/x`") || !strings.Contains(err.Error(), "commit web/x") {
		t.Fatalf("error must name the command and the directory: %v", err)
	}
}

func TestCheckStage(t *testing.T) {
	src := testFS(goodProject)
	withClip(t, src)
	cfg := Config{Src: src}
	if err := checkStage(cfg); err != nil {
		t.Fatalf("a consistent stage failed: %v", err)
	}
	src[StageSums] = &fstest.MapFile{Data: []byte("stage 0000\n")}
	if err := checkStage(cfg); err == nil || !strings.Contains(err.Error(), "home stage poster out of date") {
		t.Fatalf("stale stage sum not caught: %v", err)
	}
	delete(src, StagePoster)
	if err := checkStage(cfg); err == nil || !strings.Contains(err.Error(), "no home stage poster") {
		t.Fatalf("missing poster not caught: %v", err)
	}
}
