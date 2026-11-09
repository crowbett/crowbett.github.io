package site

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ShellTries are the calls the terminal (web/assets/shell.js) offers for each
// live demo: `try <slug>` types and runs them in order against the real
// binary. Each is a method, then optionally its params as a JSON object.
// e2e TestShell runs kvlite's; a demo whose RPC changes must keep its
// tries working (docs/demo-contract.md).
var ShellTries = map[string][]string{
	"keel":       {`run {"seed": 7}`},
	"kvlite":     {`put {"key": "user:1", "value": "alice"}`, `put {"key": "user:1", "value": "carol"}`, `get {"key": "user:1"}`, `state`},
	"stash":      {`init`, `backup {"text": "hello world, hello world, hello world"}`, `scan {"text": "hello world"}`},
	"btrv":       {`sample`},
	"ratelimitd": {`race {"pattern": "burst", "seed": 1, "rate": 10, "periodMs": 1000, "burst": 5, "durationMs": 5000, "buckets": 10}`},
	"edgecache":  {`timeline {"origin": {"cacheControl": "max-age=60", "etag": "\"v1\""}, "requests": [{"at": 0}, {"at": 30}, {"at": 61}]}`},
	"jobrun":     {`cron {"expr": "*/15 9-17 * * MON-FRI", "tz": "UTC", "start": "2026-11-09T08:00:00Z", "count": 5}`, `backoff {"policy": {"base": "100ms", "max": "10s", "factor": 2, "jitter": true}, "maxAttempts": 6, "seed": 1, "samples": 5}`},
	"lobby":      {`reset {"mode": "duel", "rate": 1, "sigma": 100, "drop": 0, "refill": true, "seed": 1}`, `advance {"ms": 2000}`},
	"grepall":    {`corpus`, `build`, `plan {"q": "func New", "regex": false, "case": "auto"}`},
	"codegraph":  {`sample`, `callers {"symbol": "main"}`},
	"mcpbridge":  {`scenarios`, `open {"server": "legacy", "seed": 1}`},
	"anchorflow": {`catalog`, `plan {"lines": [{"name": "Coffee bag", "class": "BAG", "l": 8.75, "w": 4.5, "h": 2.25, "qty": 3}], "exclude": []}`},
	"netcode":    {`new {"seed": 1, "players": 6}`, `step {"ticks": 60}`},
	"raytracer":  {`load {"scene": "cornell", "width": 64, "seed": 1}`, `render {"sampling": "nee", "y0": 0, "rows": 8}`},
	"strata":     {`models`, `load {"model": "xy"}`, `slice {"layerHeight": 0.2}`, `layer {"index": 10}`},
	"recall":     {`corpus`, `ingest {"source": "notes"}`, `search {"q": "postmortem lease", "limit": 3, "top": 3}`},
}

// checkTries reports a live project without tries, a try for a project that
// is not live, and a try that is not a method and an optional JSON object.
func checkTries(projects []Project) []string {
	var bad []string
	live := map[string]bool{}
	for _, p := range projects {
		live[p.Slug] = p.Live()
		if p.Live() && len(ShellTries[p.Slug]) == 0 {
			bad = append(bad, fmt.Sprintf("%s is live but has no ShellTries", p.Slug))
		}
	}
	for slug, tries := range ShellTries {
		if !live[slug] {
			bad = append(bad, fmt.Sprintf("ShellTries names %s, which is not a live project", slug))
		}
		for _, t := range tries {
			method, params, _ := strings.Cut(t, " ")
			var obj map[string]any
			if method == "" || strings.ContainsAny(method, "{}\" ") || params != "" && json.Unmarshal([]byte(params), &obj) != nil {
				bad = append(bad, fmt.Sprintf("%s try %q is not `method [json object]`", slug, t))
			}
		}
	}
	return bad
}
