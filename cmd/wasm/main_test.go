package main

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
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
	slug := "test-fixed-dir"
	dir, unlock, err := sourceDir(slug)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "left"), nil, 0o644)
	unlock()
	again, unlock, err := sourceDir(slug)
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

func TestSourceDirRejectsPathSlugs(t *testing.T) {
	for _, slug := range []string{"", "..", "../..", "a/b", "/tmp", "A"} {
		if _, _, err := sourceDir(slug); err == nil {
			t.Errorf("slug %q was accepted", slug)
		}
	}
}

func wasmSection(id byte, parts ...[]byte) []byte {
	body := bytes.Join(parts, nil)
	return append([]byte{id, byte(len(body))}, body...)
}

func wasmStr(s string) []byte { return append([]byte{byte(len(s))}, s...) }

func TestCheckBareModule(t *testing.T) {
	head := []byte("\x00asm\x01\x00\x00\x00")
	exports := func(names ...string) []byte {
		parts := [][]byte{{byte(len(names))}}
		for i, n := range names {
			kind := byte(0)
			if n == "memory" {
				kind = 2
			}
			parts = append(parts, wasmStr(n), []byte{kind, byte(i)})
		}
		return wasmSection(7, parts...)
	}
	ok := bytes.Join([][]byte{head, wasmSection(1, []byte{0}), exports("memory", "demo_alloc", "demo_free", "demo_call", "_extra")}, nil)
	if err := checkBareModule(ok); err != nil {
		t.Fatalf("bare module rejected: %v", err)
	}
	imp := wasmSection(2, []byte{1}, wasmStr("wasi_snapshot_preview1"), wasmStr("fd_write"), []byte{0, 0})
	withImport := bytes.Join([][]byte{head, imp, exports("memory", "demo_alloc", "demo_free", "demo_call")}, nil)
	if err := checkBareModule(withImport); err == nil || !strings.Contains(err.Error(), "1 imports (first wasi_snapshot_preview1.fd_write)") {
		t.Fatalf("want import error, got %v", err)
	}
	missing := bytes.Join([][]byte{head, exports("memory", "demo_alloc", "demo_call")}, nil)
	if err := checkBareModule(missing); err == nil || !strings.Contains(err.Error(), "does not export demo_free") {
		t.Fatalf("want export error, got %v", err)
	}
	for _, bad := range [][]byte{nil, []byte("\x00asm\x02\x00\x00\x00"), append(head[:8:8], 7, 9, 1)} {
		if err := checkBareModule(bad); err == nil {
			t.Errorf("malformed module %q accepted", bad)
		}
	}
}

func TestCppArgs(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "webdemo", "sub"), 0o755)
	for _, f := range []string{"wasm.cpp", "extra.cpp", "bridge_test.cpp", "bridge.h", "sub/deep.cpp"} {
		os.WriteFile(filepath.Join(root, "webdemo", f), nil, 0o644)
	}
	args, err := cppArgs("/sdk", root, "./webdemo", "/out.wasm", false)
	if err != nil {
		t.Fatal(err)
	}
	n := len(args)
	if got := args[n-2:]; got[0] != filepath.Join(root, "webdemo", "extra.cpp") || got[1] != filepath.Join(root, "webdemo", "wasm.cpp") {
		t.Fatalf("sources: want extra.cpp then wasm.cpp, no tests or subdirectories; got %v", args)
	}
	for _, want := range []string{"--no-default-config", "--target=wasm32-wasip1", "--sysroot=/sdk/share/wasi-sysroot", "-fno-exceptions", "-fno-rtti",
		"-nostartfiles", "-Wl,--no-entry", "-Wl,--strip-all", "-ffile-prefix-map=" + root + "=/src", "-ffile-prefix-map=/sdk=/wasi-sdk"} {
		if !slices.Contains(args, want) {
			t.Errorf("missing %s in %v", want, args)
		}
	}
	if _, err := cppArgs("/sdk", root, "./webdemo/sub/none", "/out.wasm", false); err == nil {
		t.Error("missing directory accepted")
	}
	os.MkdirAll(filepath.Join(root, "empty"), 0o755)
	if _, err := cppArgs("/sdk", root, "./empty", "/out.wasm", false); err == nil || !strings.Contains(err.Error(), "no .cpp files") {
		t.Errorf("want no-sources error, got %v", err)
	}
}

func TestWasiSDKVersion(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WASI_SDK_PATH", dir)
	if _, _, err := wasiSDK(); err == nil || !strings.Contains(err.Error(), "make wasi-sdk") {
		t.Fatalf("missing SDK: want install hint, got %v", err)
	}
	os.WriteFile(filepath.Join(dir, "VERSION"), []byte("33.0\nwasi-libc: abc\n"), 0o644)
	if _, _, err := wasiSDK(); err == nil || !strings.Contains(err.Error(), "want "+wasiSDKVersion) {
		t.Fatalf("old SDK: want version error, got %v", err)
	}
	os.WriteFile(filepath.Join(dir, "VERSION"), []byte(wasiSDKVersion+"\nwasi-libc: 2e6fb9d8ee0c\nllvm: 895aa2c896ad\n"), 0o644)
	got, version, err := wasiSDK()
	if err != nil || version != "wasi-sdk "+wasiSDKVersion+", wasi-libc 2e6fb9d8ee0c" || !filepath.IsAbs(got) {
		t.Fatalf("got %q %q %v", got, version, err)
	}
	script, err := os.ReadFile("../../scripts/wasi-sdk.sh")
	if err != nil || !bytes.Contains(script, []byte("\nversion="+wasiSDKVersion+"\n")) {
		t.Fatalf("scripts/wasi-sdk.sh must install wasi-sdk %s (%v)", wasiSDKVersion, err)
	}
}

func TestClangEnvDropsSteering(t *testing.T) {
	for _, k := range []string{"CPATH", "CPLUS_INCLUDE_PATH", "SDKROOT", "CCC_OVERRIDE_OPTIONS", "CXXFLAGS", "WASI_SDK_PATH"} {
		t.Setenv(k, "x")
	}
	t.Setenv("KEEP_ME", "1")
	env := clangEnv()
	for _, kv := range env {
		if k, _, _ := strings.Cut(kv, "="); k != "KEEP_ME" && os.Getenv(k) == "x" {
			t.Errorf("%s kept", k)
		}
	}
	if !slices.Contains(env, "KEEP_ME=1") {
		t.Error("unrelated variable dropped")
	}
}

func TestSourceDirReportsCleanupFailure(t *testing.T) {
	slug := "test-cleanup-fails"
	dir, unlock, err := sourceDir(slug)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "f"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(sub, 0o500); err != nil {
		t.Fatal(err)
	}
	defer func() {
		os.Chmod(sub, 0o755)
		os.RemoveAll(dir)
		os.Remove(filepath.Join(filepath.Dir(dir), slug+".lock"))
	}()
	if os.Getuid() == 0 {
		t.Skip("root removes read-only trees")
	}
	if d, unlock, err := sourceDir(slug); err == nil {
		unlock()
		t.Fatalf("sourceDir returned %s with no error though it could not empty it", d)
	}
}
