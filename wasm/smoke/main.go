//go:build js && wasm

// Command smoke is the pipeline's own demo: it proves that a Go binary loads in
// the worker, registers the bridge and answers calls. Every project demo
// follows the same contract (docs/demo-contract.md).
package main

import (
	"encoding/json"
	"runtime"
	"syscall/js"
)

func main() {
	js.Global().Set("__demo", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 2 {
			return encode(map[string]string{"error": "want (method, paramsJSON)"})
		}
		return encode(handle(args[0].String(), args[1].String()))
	}))
	js.Global().Call("__demoReady")
	select {}
}

func handle(method, params string) any {
	switch method {
	case "ping":
		var p struct {
			Echo string `json:"echo"`
		}
		if err := json.Unmarshal([]byte(params), &p); err != nil {
			return map[string]string{"error": "params: " + err.Error()}
		}
		return map[string]string{"go": runtime.Version(), "echo": p.Echo}
	case "hang": // e2e: a call that never returns
		for {
		}
	case "panic": // e2e: a crash inside the bridge
		panic("smoke: deliberate panic")
	default:
		return map[string]string{"error": "unknown method " + method}
	}
}

func encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"encode failed"}`
	}
	return string(b)
}
