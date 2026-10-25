.PHONY: gate fmt tidy vet test site wasm wasm-check e2e serve

# CI runs `make -j8 NICE="nice -n 10" gate e2e` and must stay under 60 s: every
# target starts at once and the gate yields the CPU to e2e, the longest (F5 in
# docs/tasks.md). Run both locally before every push.
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

wasm-check:
	$(NICE) go run ./cmd/wasm check

e2e:
	go test -tags e2e -count=1 -vet=off -parallel 12 ./e2e

serve:
	go run ./cmd/site serve
