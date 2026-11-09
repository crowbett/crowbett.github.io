package main

// showcase is what a clip shows once the demo is running. setup runs before
// recording starts and play while it records; both are JS expressions that
// may return a promise. The clip is a 16:10 crop whose top edge and width are
// focus's box (the demo mount by default) grown by pad CSS px on each side.
type showcase struct {
	setup, play, focus string
	pad                int
	seconds            float64
}

var shows = map[string]showcase{
	"btrv":       {seconds: 6},
	"codegraph":  {seconds: 6},
	"edgecache":  {seconds: 6},
	"grepall":    {seconds: 6},
	"jobrun":     {seconds: 6},
	"keel":       {seconds: 6},
	"kvlite":     {seconds: 6},
	"lobby":      {seconds: 6},
	"mcpbridge":  {seconds: 6},
	"netcode":    {seconds: 6},
	"ratelimitd": {seconds: 6},
	"raytracer":  {seconds: 6},
	"stash":      {seconds: 6},
	"strata":     {seconds: 6},
}
