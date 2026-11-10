package site

import (
	"strings"
	"testing"
	"testing/fstest"
)

func TestLoadTree(t *testing.T) {
	d := demoSize{Raw: 10, Full: "abc"}
	tree := func(sha, body string) fstest.MapFS {
		return fstest.MapFS{TreeDir + "/x.json": {Data: []byte(`{"slug":"x","kind":"go","sha256":"` + sha + `","bytes":10,"tree":` + body + `}`)}}
	}
	good := `{"n":"x","b":10,"f":2,"k":[{"n":"Own code","b":7,"f":2,"k":[{"n":"a","b":4,"f":1,"i":3}],"o":{"c":1,"f":1,"b":3}},{"n":"Data","b":3,"f":0}]}`
	if _, err := loadTree(tree("abc", good), "x", d); err != nil {
		t.Fatalf("a tree that adds up: %v", err)
	}
	for name, c := range map[string]struct {
		src  fstest.MapFS
		want string
	}{
		"missing":   {fstest.MapFS{}, "no byte tree"},
		"stale sha": {tree("old", good), "another build"},
		"short":     {tree("abc", `{"n":"x","b":9,"f":0}`), "another build"},
		"bad sum":   {tree("abc", strings.Replace(good, `"b":4,`, `"b":5,`, 1)), `"Own code" holds 7 bytes`},
		"bad funcs": {tree("abc", strings.Replace(good, `"c":1,"f":1`, `"c":1,"f":2`, 1)), "in 3"},
		"surname":   {tree("abc", strings.Replace(good, `"n":"a"`, `"n":"Jouett"`, 1)), "must not publish"},
	} {
		if _, err := loadTree(c.src, "x", d); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want an error with %q", name, err, c.want)
		}
	}
}

func TestBuildLevels(t *testing.T) {
	lv := buildLevels([]binLevel{
		{Slug: "a", Bytes: 100, Funcs: 1, Gzip: 50},
		{Slug: "b", Bytes: 300, Funcs: 2, Gzip: 90},
		{Slug: "c", Bytes: 600, Funcs: 3, Gzip: 40},
	}, []string{"go", "rust", "go"})
	if lv.Bytes != 1000 || lv.Funcs != 6 || lv.LightestGz != "c" || lv.HeaviestGz != "b" {
		t.Fatalf("totals: %+v", lv)
	}
	if len(lv.Langs) != 2 || lv.Langs[0].Kind != "go" || lv.Langs[0].Note != "2 binaries" || lv.Langs[1].Note != "1 binary" {
		t.Fatalf("languages: %+v", lv.Langs)
	}
	if g := lv.Langs[0]; g.Share != "70.0%" || g.Bins[0].Slug != "c" || g.Bins[1].Share != "14.3%" {
		t.Fatalf("go: %+v", g)
	}
	if s, _ := share(1, 5000); s != "<0.1%" {
		t.Fatalf("share(1, 5000) = %q", s)
	}
}
