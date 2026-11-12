package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestCleanEnvDropsRustSteering(t *testing.T) {
	for _, k := range []string{"CARGO_PROFILE_RELEASE_LTO", "RUSTFLAGS", "RUSTC_WRAPPER", "RUSTUP_TOOLCHAIN"} {
		t.Setenv(k, "x")
	}
	t.Setenv("CARGO_HOME", "/c")
	t.Setenv("RUSTUP_HOME", "/r")
	t.Setenv("KEEP_ME", "1")
	env := cleanEnv()
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		if os.Getenv(k) == "x" {
			t.Errorf("%s kept", k)
		}
	}
	for _, kv := range []string{"CARGO_HOME=/c", "RUSTUP_HOME=/r", "KEEP_ME=1"} {
		if !slices.Contains(env, kv) {
			t.Errorf("%s dropped", kv)
		}
	}
}

func TestHasToolchainFileStopsAtRoot(t *testing.T) {
	outer := t.TempDir()
	root := filepath.Join(outer, "repo")
	sub := filepath.Join(root, "crates", "demo")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outer, "rust-toolchain"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if hasToolchainFile(sub, root) {
		t.Error("found a toolchain file above the repo root")
	}
	if err := os.WriteFile(filepath.Join(root, "rust-toolchain.toml"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if !hasToolchainFile(sub, root) {
		t.Error("missed the repo's rust-toolchain.toml")
	}
}

func TestEnvOut(t *testing.T) {
	out, err := envOut(t.TempDir(), []string{"X=hi"}, "sh", "-c", "echo $X")
	if err != nil || out != "hi" {
		t.Fatalf("envOut = %q, %v", out, err)
	}
	if _, err := envOut(t.TempDir(), nil, "sh", "-c", "echo boom >&2; exit 3"); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("error should carry stderr, got %v", err)
	}
}
