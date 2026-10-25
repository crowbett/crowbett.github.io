TIME = /usr/bin/time -f "TIME %e wall %U user %S sys: %C"
.PHONY: gate fmt tidy vet test site wasm wasm-check e2e serve

# CI runs `make -j8 NICE="nice -n 10" gate e2e` and must stay under 60 s: every
# target starts at once and the gate yields the CPU to e2e, the longest (F5 in
# docs/tasks.md). Run both locally before every push.
gate: fmt tidy vet test site wasm-check

fmt:
	@echo "T $@ start $$(date +%s.%N)"
	@test -z "$$(gofmt -l .)" || (gofmt -l . && echo "gofmt needed" && exit 1)
	@echo "T fmt end $$(date +%s.%N)"

tidy:
	@echo "T $@ start $$(date +%s.%N)"
	$(NICE) $(TIME) go mod tidy -diff
	@echo "T tidy end $$(date +%s.%N)"

vet:
	@echo "T $@ start $$(date +%s.%N)"
	$(NICE) $(TIME) go vet ./...
	$(NICE) $(TIME) go vet -tags e2e ./e2e
	GOOS=js GOARCH=wasm $(NICE) go vet ./wasm/...
	@echo "T vet end $$(date +%s.%N)"

test:
	@echo "T $@ start $$(date +%s.%N)"
	$(NICE) $(TIME) go test -race -count=1 -vet=off ./...
	@echo "T test end $$(date +%s.%N)"

site:
	@echo "T $@ start $$(date +%s.%N)"
	$(NICE) $(TIME) go run ./cmd/site build
	@echo "T site end $$(date +%s.%N)"

wasm:
	go run ./cmd/wasm build

wasm-check:
	@echo "T $@ start $$(date +%s.%N)"
	$(NICE) $(TIME) go run ./cmd/wasm check
	@echo "T wasm-check end $$(date +%s.%N)"

e2e:
	@echo "T $@ start $$(date +%s.%N)"
	$(TIME) go test -tags e2e -count=1 -vet=off -parallel 12 -v ./e2e
	@echo "T e2e end $$(date +%s.%N)"

serve:
	go run ./cmd/site serve
