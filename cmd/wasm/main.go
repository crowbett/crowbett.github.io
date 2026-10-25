// Command wasm builds the demo binaries in web/wasm/ from commits pinned in
// demos.lock.json, and checks that the committed binaries match the lock.
//
//	wasm build [slug...]     rebuild (all, or the named demos) and update the lock
//	wasm check               verify web/wasm/* against the lock (CI runs this)
//	wasm pin <slug> <ref>    pin a demo to a commit (must be pushed; -allow-unpushed to override)
//
// Project repos are read from $DEV_ROOT (default ~/dev) with `git archive`, so
// uncommitted work never leaks into a published binary. The demo with repo "."
// is built from this repository's working tree (the pipeline smoke test).
// A demo of kind "rust" is a cdylib crate built for wasm32-unknown-unknown with
// the toolchain its rust-toolchain.toml pins (docs/demo-contract.md).
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
)

const lockFile = "demos.lock.json"

// Lock pins every demo binary to its source.
type Lock struct {
	Go             string `json:"go"`               // toolchain that built every binary, e.g. go1.27.0
	WasmExecSHA256 string `json:"wasm_exec_sha256"` // web/wasm/wasm_exec.js, copied from that toolchain
	Demos          []Demo `json:"demos"`
}

// Demo is one binary.
type Demo struct {
	Slug     string `json:"slug"`
	Kind     string `json:"kind,omitempty"`     // "go" (default) or "rust"
	Repo     string `json:"repo"`               // directory under $DEV_ROOT, or "." for this repo
	Ref      string `json:"ref,omitempty"`      // full commit SHA; empty only for repo "."
	Pkg      string `json:"pkg"`                // Go package or Rust crate directory, e.g. ./cmd/webdemo
	Siblings []Dep  `json:"siblings,omitempty"` // repos the build needs next to it (go.mod replace ../x)
	Rustc    string `json:"rustc,omitempty"`    // compiler that built a rust demo, from rustc -V
	SHA256   string `json:"sha256"`
	Bytes    int    `json:"bytes"`
	Gzip     int    `json:"gzip_bytes"`
}

// Dep is a sibling checkout pinned to a commit.
type Dep struct {
	Repo string `json:"repo"`
	Ref  string `json:"ref"`
}

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		log.Fatal("usage: wasm build [slug...] | check | pin <slug> <ref>")
	}
	fl := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	allowUnpushed := fl.Bool("allow-unpushed", false, "pin: accept a commit no remote branch contains")
	fl.Parse(os.Args[2:])
	lock, err := readLock()
	if err != nil {
		log.Fatal(err)
	}
	switch os.Args[1] {
	case "build":
		err = build(lock, fl.Args())
	case "check":
		err = check(lock)
	case "pin":
		if fl.NArg() != 2 {
			log.Fatal("usage: wasm pin <slug> <ref>")
		}
		err = pin(lock, fl.Arg(0), fl.Arg(1), *allowUnpushed)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		log.Fatal(err)
	}
}

func devRoot() string {
	if d := os.Getenv("DEV_ROOT"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "dev")
}

func build(lock *Lock, only []string) error {
	if lock.Go != "" && lock.Go != runtime.Version() && len(only) > 0 {
		return fmt.Errorf("lock was built with %s but this is %s: rebuild every demo (run `wasm build` with no names) so wasm_exec.js matches all of them", lock.Go, runtime.Version())
	}
	for i := range lock.Demos {
		d := &lock.Demos[i]
		if len(only) > 0 && !slices.Contains(only, d.Slug) {
			continue
		}
		if err := buildOne(d); err != nil {
			return fmt.Errorf("%s: %w", d.Slug, err)
		}
		log.Printf("%-10s %s  %7d bytes  %7d gzipped", d.Slug, short(d.Ref), d.Bytes, d.Gzip)
	}
	execJS, err := os.ReadFile(filepath.Join(runtime.GOROOT(), "lib", "wasm", "wasm_exec.js"))
	if err != nil {
		return err
	}
	if err := os.WriteFile("web/wasm/wasm_exec.js", execJS, 0o644); err != nil {
		return err
	}
	lock.Go, lock.WasmExecSHA256 = runtime.Version(), sum(execJS)
	return writeLock(lock)
}

func buildOne(d *Demo) error {
	if d.Kind != "" && d.Kind != "go" && d.Kind != "rust" {
		return fmt.Errorf("unknown kind %q (want go or rust)", d.Kind)
	}
	dir := "."
	if d.Repo != "." {
		if len(d.Ref) != 40 {
			return fmt.Errorf("ref must be a full commit SHA; use `wasm pin`")
		}
		tmp, err := os.MkdirTemp("", "wasm-"+d.Slug+"-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)
		for _, dep := range append([]Dep{{d.Repo, d.Ref}}, d.Siblings...) {
			if err := export(dep, filepath.Join(tmp, filepath.Base(dep.Repo))); err != nil {
				return err
			}
		}
		dir = filepath.Join(tmp, filepath.Base(d.Repo))
	}
	out, err := filepath.Abs(filepath.Join("web", "wasm", d.Slug+".wasm"))
	if err != nil {
		return err
	}
	if d.Kind == "rust" {
		if err := buildRust(d, dir, out); err != nil {
			return err
		}
	} else {
		cmd := exec.Command("go", "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", out, d.Pkg)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm", "CGO_ENABLED=0")
		cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("go build: %w", err)
		}
	}
	b, err := os.ReadFile(out)
	if err != nil {
		return err
	}
	d.SHA256, d.Bytes, d.Gzip = sum(b), len(b), gzipLen(b)
	return nil
}

// export writes repo@ref into dst with git archive (committed files only).
func export(dep Dep, dst string) error {
	src := filepath.Join(devRoot(), dep.Repo)
	var arc bytes.Buffer
	cmd := exec.Command("git", "-C", src, "archive", "--format=tar", dep.Ref)
	cmd.Stdout, cmd.Stderr = &arc, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git archive %s@%s: %w", dep.Repo, short(dep.Ref), err)
	}
	tr := tar.NewReader(&arc)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Join(dst, filepath.FromSlash(h.Name))
		if !strings.HasPrefix(name, filepath.Clean(dst)+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes destination: %s", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(name, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
			if err != nil {
				return err
			}
			_, err = io.Copy(f, tr) //nolint:gosec // our own repos
			f.Close()
			if err != nil {
				return err
			}
		}
	}
}

func check(lock *Lock) error {
	var bad []string
	for _, d := range lock.Demos {
		b, err := os.ReadFile(filepath.Join("web", "wasm", d.Slug+".wasm"))
		switch {
		case err != nil:
			bad = append(bad, fmt.Sprintf("%s: %v", d.Slug, err))
		case sum(b) != d.SHA256:
			bad = append(bad, fmt.Sprintf("%s: binary does not match the lock (rebuild with `make wasm`)", d.Slug))
		}
	}
	execJS, err := os.ReadFile("web/wasm/wasm_exec.js")
	if err != nil || sum(execJS) != lock.WasmExecSHA256 {
		bad = append(bad, "wasm_exec.js does not match the lock")
	}
	entries, err := os.ReadDir(filepath.Join("web", "wasm"))
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := e.Name()
		known := name == "wasm_exec.js" || slices.ContainsFunc(lock.Demos, func(d Demo) bool { return d.Slug+".wasm" == name })
		if !known {
			bad = append(bad, fmt.Sprintf("web/wasm/%s is not in the lock and would be published: delete it", name))
		}
	}
	if len(bad) > 0 {
		return errors.New(strings.Join(bad, "\n"))
	}
	log.Printf("%d demo binaries match %s (built with %s)", len(lock.Demos), lockFile, lock.Go)
	return nil
}

func pin(lock *Lock, slug, ref string, allowUnpushed bool) error {
	i := slices.IndexFunc(lock.Demos, func(d Demo) bool { return d.Slug == slug })
	if i < 0 {
		return fmt.Errorf("no demo %q in %s; add an entry first", slug, lockFile)
	}
	d := &lock.Demos[i]
	src := filepath.Join(devRoot(), d.Repo)
	full, err := gitOut(src, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return err
	}
	if remote, _ := gitOut(src, "branch", "-r", "--contains", full); remote == "" && !allowUnpushed {
		return fmt.Errorf("%s@%s is on no remote branch: push it first so the pin is reproducible", d.Repo, short(full))
	}
	d.Ref = full
	return writeLock(lock)
}

func gitOut(dir string, args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		return "", fmt.Errorf("git %s in %s: %w", strings.Join(args, " "), dir, err)
	}
	return strings.TrimSpace(string(out)), nil
}

func readLock() (*Lock, error) {
	b, err := os.ReadFile(lockFile)
	if err != nil {
		return nil, err
	}
	var l Lock
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&l); err != nil {
		return nil, fmt.Errorf("%s: %w", lockFile, err)
	}
	return &l, nil
}

func writeLock(l *Lock) error {
	b, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(lockFile, append(b, '\n'), 0o644)
}

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func gzipLen(b []byte) int {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(b)
	w.Close()
	return buf.Len()
}

func short(ref string) string {
	if len(ref) > 7 {
		return ref[:7]
	}
	if ref == "" {
		return "worktree"
	}
	return ref
}
