// Command site builds, checks and serves the static site.
//
//	site build [-out dist]          render into dist, then run the checks
//	site serve [-addr :8000]        build, then serve dist (local preview and e2e)
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: site build|serve [flags]")
		os.Exit(2)
	}
	fl := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	out := fl.String("out", "dist", "output directory")
	addr := fl.String("addr", "127.0.0.1:8000", "serve address")
	fl.Parse(os.Args[2:])

	build := func() {
		cfg := site.Config{Src: os.DirFS("."), Out: *out, Owner: site.DefaultOwner, Now: time.Now()}
		if err := site.Build(cfg); err != nil {
			log.Fatal(err)
		}
		if err := site.Check(*out); err != nil {
			log.Fatal(err)
		}
	}
	switch os.Args[1] {
	case "build":
		build()
		fmt.Println("built", *out)
	case "serve":
		build()
		fs := http.FileServer(http.Dir(*out))
		h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			fs.ServeHTTP(w, r)
		})
		log.Printf("serving %s on http://%s", *out, *addr)
		log.Fatal(http.ListenAndServe(*addr, h))
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
}
