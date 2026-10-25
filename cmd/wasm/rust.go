package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const rustTarget = "wasm32-unknown-unknown"

// buildRust builds the cdylib crate at d.Pkg under root with the toolchain
// rustup selects there (the repo's rust-toolchain.toml), into a scratch target
// directory, and copies the one .wasm it produced to out.
func buildRust(d *Demo, root, out string) error {
	root, err := filepath.Abs(root)
	if err == nil {
		root, err = filepath.EvalSymlinks(root)
	}
	if err != nil {
		return err
	}
	crate := filepath.Join(root, filepath.FromSlash(d.Pkg))
	if !hasToolchainFile(crate, root) {
		return fmt.Errorf("no rust-toolchain.toml between %s and the repo root: pin the toolchain", d.Pkg)
	}
	env := cleanEnv()
	cargo, err := envOut(crate, env, "rustup", "which", "cargo")
	if err != nil {
		return err
	}
	bin := filepath.Dir(cargo)
	rustc := filepath.Join(bin, "rustc")
	if d.Rustc, err = envOut(crate, env, rustc, "-V"); err != nil {
		return err
	}
	verbose, err := envOut(crate, env, rustc, "-vV")
	if err != nil {
		return err
	}
	_, commit, _ := strings.Cut(verbose, "commit-hash: ")
	commit, _, _ = strings.Cut(commit, "\n")
	sysroot, err := envOut(crate, env, rustc, "--print", "sysroot")
	if err != nil {
		return err
	}
	if _, err := envOut(crate, env, "rustup", "target", "add", rustTarget); err != nil {
		return err
	}
	target, err := os.MkdirTemp("", "wasm-"+d.Slug+"-target-")
	if err == nil {
		target, err = filepath.EvalSymlinks(target)
	}
	if err != nil {
		return err
	}
	defer os.RemoveAll(target)
	// An exported repo sits next to its siblings, which path deps reach.
	src := root
	if d.Repo != "." {
		src = filepath.Dir(root)
	}
	home := os.Getenv("CARGO_HOME")
	if home == "" {
		h, _ := os.UserHomeDir()
		home = filepath.Join(h, ".cargo")
	}
	// Local paths would otherwise be embedded in panic locations, so the
	// binary would differ by checkout and publish this machine's layout. The
	// last matching remap wins: with rust-src installed, rustc resolves std
	// paths into the sysroot, so map those back to what a toolchain without it
	// embeds.
	flags := []string{
		"--remap-path-prefix=" + src + "=/src",
		"--remap-path-prefix=" + target + "=/target",
		"--remap-path-prefix=" + home + "=/cargo",
		"--remap-path-prefix=" + sysroot + "=/rustc",
		"--remap-path-prefix=" + filepath.Join(sysroot, "lib", "rustlib", "src", "rust") + "=/rustc/" + commit,
	}
	cmd := exec.Command(cargo, "build", "--release", "--locked", "--target", rustTarget, "--message-format=json-render-diagnostics")
	cmd.Dir = crate
	cmd.Env = append(env,
		"PATH="+bin+string(os.PathListSeparator)+os.Getenv("PATH"), // build scripts must not find another rustc
		"RUSTC="+rustc,
		"CARGO_TARGET_DIR="+target,
		"CARGO_ENCODED_RUSTFLAGS="+strings.Join(flags, "\x1f"),
		"DYLD_FALLBACK_LIBRARY_PATH="+filepath.Join(sysroot, "lib"), // rustup's rust-lld on macOS cannot find libLLVM otherwise
	)
	var stdout bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("cargo build: %w", err)
	}
	var wasm []string
	sc := bufio.NewScanner(&stdout)
	sc.Buffer(nil, 64<<20)
	for sc.Scan() {
		var m struct {
			Reason    string   `json:"reason"`
			Filenames []string `json:"filenames"`
		}
		if json.Unmarshal(sc.Bytes(), &m) != nil || m.Reason != "compiler-artifact" {
			continue
		}
		for _, f := range m.Filenames {
			if strings.HasSuffix(f, ".wasm") {
				wasm = append(wasm, f)
			}
		}
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("cargo output: %w", err)
	}
	if len(wasm) != 1 {
		return fmt.Errorf("cargo build produced %d .wasm files, want 1 (is %s a cdylib?): %v", len(wasm), d.Pkg, wasm)
	}
	b, err := os.ReadFile(wasm[0])
	if err != nil {
		return err
	}
	return os.WriteFile(out, b, 0o644)
}

// cleanEnv is this process's environment without the variables that steer
// cargo, rustc or rustup's toolchain choice (CARGO_PROFILE_*, RUSTFLAGS,
// RUSTC_WRAPPER, RUSTUP_TOOLCHAIN...), so the repo's files alone decide the build.
func cleanEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		if (strings.HasPrefix(k, "CARGO_") && k != "CARGO_HOME") || (strings.HasPrefix(k, "RUST") && k != "RUSTUP_HOME") {
			continue
		}
		env = append(env, kv)
	}
	return env
}

func hasToolchainFile(dir, root string) bool {
	for {
		for _, f := range []string{"rust-toolchain.toml", "rust-toolchain"} {
			if _, err := os.Stat(filepath.Join(dir, f)); err == nil {
				return true
			}
		}
		if dir == root || !strings.HasPrefix(dir, root) {
			return false
		}
		dir = filepath.Dir(dir)
	}
}

func envOut(dir string, env []string, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir, cmd.Env = dir, env
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(string(out)), nil
}
