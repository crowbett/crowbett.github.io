.PHONY: gate fmt tidy vet test site wasm wasm-check e2e serve

# CI runs `make -j4 gate e2e` and must stay under 60 s; run both locally before every push.
gate: fmt tidy vet test site wasm-check

fmt:
	@test -z "$$(gofmt -l .)" || (gofmt -l . && echo "gofmt needed" && exit 1)

tidy:
	go mod tidy -diff

vet:
	go vet ./...
	go vet -tags e2e ./e2e
	GOOS=js GOARCH=wasm go vet ./wasm/...

test:
	go test -race -count=1 ./...

site:
	go run ./cmd/site build

wasm:
	go run ./cmd/wasm build

wasm-check:
	go run ./cmd/wasm check

e2e:
	go test -tags e2e -count=1 -parallel 12 -v ./e2e > /tmp/e2e.log; s=$$?; grep -E -- "--- |^ok|FAIL|ZZ" /tmp/e2e.log; exit $$s

serve:
	go run ./cmd/site serve
