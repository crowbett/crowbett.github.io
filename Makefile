.PHONY: gate fmt tidy vet test site wasm wasm-check wasi-sdk e2e serve fonts

# CI runs `make -j8 gate` and `make e2e` on separate runners and must stay under
# 60 s. Locally, NICE="nice -n 10" lets the gate yield the CPU to e2e. Tests skip
# go test's vet: the vet target runs every analyzer on the same packages. Run
# both before every push.
gate: fmt tidy vet test site wasm-check

fmt:
	@test -z "$$(gofmt -l .)" || (gofmt -l . && echo "gofmt needed" && exit 1)

tidy:
	$(NICE) go mod tidy -diff

vet:
	$(NICE) go vet ./...
	$(NICE) go vet -tags e2e ./e2e
	GOOS=js GOARCH=wasm $(NICE) go vet ./wasm/...

test:
	$(NICE) go test -race -count=1 -vet=off ./...

site:
	$(NICE) go run ./cmd/site build

wasm:
	go run ./cmd/wasm build

# The C++ toolchain `wasm build` needs for cpp demos; CI only checks hashes.
wasi-sdk:
	./scripts/wasi-sdk.sh

wasm-check:
	$(NICE) go run ./cmd/wasm check

e2e:
	go test -tags e2e -count=1 -vet=off -parallel 12 $(E2E_FLAGS) ./e2e

serve:
	go run ./cmd/site serve

fonts:
	./scripts/fonts.sh
