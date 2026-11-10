package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
)

// wasiSDKVersion is the wasi-sdk release C++ demos build with; scripts/wasi-sdk.sh
// installs it (checksummed) and must name the same version.
const wasiSDKVersion = "34.0"

// cppExports are the exports the worker needs, the Rust bridge's ABI.
var cppExports = []string{"memory", "demo_alloc", "demo_call", "demo_free"}

// wasiSDK returns the SDK root: $WASI_SDK_PATH, or where scripts/wasi-sdk.sh puts
// it. Its VERSION file must name wasiSDKVersion.
func wasiSDK() (dir, version string, err error) {
	dir = os.Getenv("WASI_SDK_PATH")
	if dir == "" {
		arch := map[string]string{"arm64": "arm64", "amd64": "x86_64"}[runtime.GOARCH]
		osName := map[string]string{"darwin": "macos", "linux": "linux"}[runtime.GOOS]
		cache := os.Getenv("XDG_CACHE_HOME")
		if cache == "" {
			home, _ := os.UserHomeDir()
			cache = filepath.Join(home, ".cache")
		}
		dir = filepath.Join(cache, "crowbett-wasm", "wasi-sdk-"+wasiSDKVersion+"-"+arch+"-"+osName)
	}
	if dir, err = filepath.EvalSymlinks(dir); err == nil {
		dir, err = filepath.Abs(dir)
	}
	b, rerr := os.ReadFile(filepath.Join(dir, "VERSION"))
	if err != nil || rerr != nil {
		return "", "", fmt.Errorf("no wasi-sdk %s at %s: run `make wasi-sdk`", wasiSDKVersion, dir)
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if lines[0] != wasiSDKVersion {
		return "", "", fmt.Errorf("%s is wasi-sdk %s, want %s: run `make wasi-sdk`", dir, lines[0], wasiSDKVersion)
	}
	version = "wasi-sdk " + lines[0]
	for _, l := range lines[1:] {
		if libc, ok := strings.CutPrefix(l, "wasi-libc: "); ok {
			version += ", wasi-libc " + libc
		}
	}
	return dir, version, nil
}

// cppArgs is the whole compile and link line: every .cpp directly in the bridge
// directory except *_test.cpp, built single-threaded for wasm32-wasip1 without
// crt1, exceptions or RTTI (each would pull in WASI imports), with the source
// and SDK paths remapped so the binary does not depend on where it was built.
func cppArgs(sdk, root, pkg, out string, named bool) ([]string, error) {
	dir := filepath.Join(root, filepath.FromSlash(pkg))
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var srcs []string
	for _, e := range entries {
		n := e.Name()
		if !e.IsDir() && strings.HasSuffix(n, ".cpp") && !strings.HasSuffix(n, "_test.cpp") {
			srcs = append(srcs, filepath.Join(dir, n))
		}
	}
	if len(srcs) == 0 {
		return nil, fmt.Errorf("no .cpp files in %s", pkg)
	}
	slices.Sort(srcs)
	strip := "-Wl,--strip-all"
	if named {
		strip = "-Wl,--strip-debug"
	}
	args := []string{
		"--no-default-config", "--target=wasm32-wasip1", "--sysroot=" + filepath.Join(sdk, "share", "wasi-sysroot"),
		"-std=c++20", "-O3", "-DNDEBUG", "-fno-exceptions", "-fno-rtti",
		"-ffile-prefix-map=" + root + "=/src", "-ffile-prefix-map=" + sdk + "=/wasi-sdk",
		"-nostartfiles", "-Wl,--no-entry", strip, "-o", out,
	}
	return append(args, srcs...), nil
}

// buildCpp compiles the C++ bridge at d.Pkg under root with the pinned wasi-sdk
// and checks the module imports nothing and exports the bridge ABI.
func buildCpp(d *Demo, root, out string, named bool) error {
	root, err := filepath.Abs(root)
	if err == nil {
		root, err = filepath.EvalSymlinks(root)
	}
	if err != nil {
		return err
	}
	sdk, version, err := wasiSDK()
	if err != nil {
		return err
	}
	clang := filepath.Join(sdk, "bin", "clang++")
	env := clangEnv()
	ver, err := envOut(root, env, clang, "--no-default-config", "--version")
	if err != nil {
		return err
	}
	d.Clang, _, _ = strings.Cut(ver, "\n")
	d.WasiSDK = version
	args, err := cppArgs(sdk, root, d.Pkg, out, named)
	if err != nil {
		return err
	}
	cmd := exec.Command(clang, args...)
	cmd.Dir, cmd.Env = root, env
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("clang++: %w", err)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		return err
	}
	return checkBareModule(b)
}

// clangEnv drops the variables that add include paths, flags or a sysroot
// behind the command line's back (CPATH, CPLUS_INCLUDE_PATH, SDKROOT,
// CCC_OVERRIDE_OPTIONS...), so the arguments alone decide the build.
func clangEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		switch {
		case k == "CPATH", k == "SDKROOT", k == "MACOSX_DEPLOYMENT_TARGET", k == "WASI_SDK_PATH",
			strings.HasSuffix(k, "_INCLUDE_PATH"), strings.HasPrefix(k, "CCC_"), strings.HasPrefix(k, "CLANG"),
			k == "LIBRARY_PATH", k == "CFLAGS", k == "CXXFLAGS", k == "LDFLAGS":
			continue
		}
		env = append(env, kv)
	}
	return env
}

// checkBareModule fails unless the module imports nothing and exports the
// bridge ABI, so the worker can instantiate it with an empty import object.
func checkBareModule(b []byte) error {
	if len(b) < 8 || !bytes.Equal(b[:8], []byte("\x00asm\x01\x00\x00\x00")) {
		return errors.New("not a wasm module")
	}
	var exports []string
	for p := b[8:]; len(p) > 0; {
		id := p[0]
		size, n := uleb(p[1:])
		if n == 0 || uint64(len(p)-1-n) < size {
			return errors.New("truncated wasm section")
		}
		body := p[1+n : 1+n+int(size)]
		p = p[1+n+int(size):]
		switch id {
		case 2:
			if count, k := uleb(body); k > 0 && count > 0 {
				first := "?"
				if mod, rest, ok := wasmName(body[k:]); ok {
					if field, _, ok := wasmName(rest); ok {
						first = mod + "." + field
					}
				}
				return fmt.Errorf("module has %d imports (first %s): the worker gives a non-Go module none", count, first)
			}
		case 7:
			count, k := uleb(body)
			rest := body[k:]
			for range count {
				name, r, ok := wasmName(rest)
				if !ok || len(r) < 1 {
					return errors.New("truncated export section")
				}
				_, k := uleb(r[1:])
				if k == 0 {
					return errors.New("truncated export section")
				}
				exports = append(exports, name)
				rest = r[1+k:]
			}
		}
	}
	for _, want := range cppExports {
		if !slices.Contains(exports, want) {
			return fmt.Errorf("module does not export %s (exports %v)", want, exports)
		}
	}
	return nil
}

func uleb(b []byte) (v uint64, n int) {
	for shift := uint(0); n < len(b) && n < 10; shift += 7 {
		c := b[n]
		n++
		v |= uint64(c&0x7f) << shift
		if c < 0x80 {
			return v, n
		}
	}
	return 0, 0
}

func wasmName(b []byte) (name string, rest []byte, ok bool) {
	l, n := uleb(b)
	if n == 0 || uint64(len(b)-n) < l {
		return "", nil, false
	}
	return string(b[n : n+int(l)]), b[n+int(l):], true
}
