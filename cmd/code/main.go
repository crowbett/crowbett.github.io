// Command code fills each project's code excerpts (code/<slug>.json) from its
// repository at the pinned commit, highlighted, so the build never needs the
// private repos. A file names its excerpts by path and line range; this reads
// those lines with `git show <ref>:<path>` from $DEV_ROOT (default ~/dev).
// When a demo is re-pinned, each excerpt is found again at the new commit by
// its first and last lines, and the run fails if either moved apart.
//
//	go run ./cmd/code [slug...]
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

func main() {
	log.SetFlags(0)
	root := os.Getenv("DEV_ROOT")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
		}
		root = filepath.Join(home, "dev")
	}
	refs, err := site.LockRefs(os.DirFS("."))
	if err != nil {
		log.Fatal(err)
	}
	files, _ := filepath.Glob("code/*.json")
	for _, f := range files {
		slug := strings.TrimSuffix(filepath.Base(f), ".json")
		if len(os.Args) > 1 && !slices.Contains(os.Args[1:], slug) {
			continue
		}
		if err := fill(f, root, refs[slug]); err != nil {
			log.Fatalf("%s: %v", slug, err)
		}
		log.Printf("%s: filled", slug)
	}
}

func fill(file, root, lockRef string) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var c site.CodeSet
	if err := json.Unmarshal(b, &c); err != nil {
		return err
	}
	old := c.Ref
	if lockRef != "" {
		c.Ref = lockRef
	}
	if c.Ref == "" {
		return errors.New("no ref: a project without a lock entry names its commit")
	}
	for i := range c.Excerpts {
		e := &c.Excerpts[i]
		src, err := show(root, c.Repo, c.Ref, e.Path)
		if err != nil {
			return err
		}
		lines := strings.Split(strings.TrimRight(src, "\n"), "\n")
		if old != "" && old != c.Ref && len(e.Text) > 0 {
			if err := relocate(e, lines); err != nil {
				return fmt.Errorf("%s: %w", e.Path, err)
			}
		}
		if e.From < 1 || e.To < e.From || e.To > len(lines) {
			return fmt.Errorf("%s: lines %d-%d out of range (1-%d)", e.Path, e.From, e.To, len(lines))
		}
		e.Text = lines[e.From-1 : e.To]
		if bad := site.Unpublishable(strings.Join(e.Text, "\n")); bad != "" {
			return fmt.Errorf("%s: %s", e.Path, bad)
		}
		if e.Lines, err = highlight(e.Path, dedent(e.Text)); err != nil {
			return err
		}
	}
	c.Sum = c.Digest()
	out, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, append(out, '\n'), 0o644)
}

// dedent drops the indentation every non-blank line shares, so a method
// nested in a type starts at the left edge; Text keeps the file's own lines.
func dedent(text []string) []string {
	prefix := ""
	first := true
	for _, l := range text {
		if strings.TrimSpace(l) == "" {
			continue
		}
		ind := l[:len(l)-len(strings.TrimLeft(l, " \t"))]
		if first {
			prefix, first = ind, false
			continue
		}
		for !strings.HasPrefix(ind, prefix) {
			prefix = prefix[:len(prefix)-1]
		}
	}
	out := make([]string, len(text))
	for i, l := range text {
		out[i] = strings.TrimPrefix(l, prefix)
	}
	return out
}

func show(root, repo, ref, path string) (string, error) {
	out, err := exec.Command("git", "-C", filepath.Join(root, repo), "show", ref+":"+path).Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return "", fmt.Errorf("git show %s:%s: %s", ref[:7], path, strings.TrimSpace(string(ee.Stderr)))
		}
		return "", err
	}
	return string(out), nil
}

// relocate moves an excerpt to where its first line is now, and fails unless
// that line is unique and its last line kept its distance.
func relocate(e *site.Excerpt, lines []string) error {
	first, last := e.Text[0], e.Text[len(e.Text)-1]
	at := -1
	for i, l := range lines {
		if l == first {
			if at >= 0 {
				return fmt.Errorf("its first line %q is no longer unique: set from and to by hand", first)
			}
			at = i
		}
	}
	n := len(e.Text)
	if at < 0 || at+n > len(lines) || lines[at+n-1] != last {
		return fmt.Errorf("lines %d-%d changed at the new commit: set from and to by hand", e.From, e.To)
	}
	e.From, e.To = at+1, at+n
	return nil
}

// highlight renders each line as HTML with a few token classes (site CSS
// colors them), never inline styles, which the CSP forbids.
func highlight(path string, text []string) ([]string, error) {
	lx := lexers.Match(path)
	if lx == nil {
		lx = lexers.Fallback
	}
	it, err := chroma.Coalesce(lx).Tokenise(nil, strings.Join(text, "\n")+"\n")
	if err != nil {
		return nil, err
	}
	var out []string
	var b strings.Builder
	for _, t := range it.Tokens() {
		cls := class(t.Type)
		for i, part := range strings.Split(t.Value, "\n") {
			if i > 0 {
				out = append(out, b.String())
				b.Reset()
			}
			if part == "" {
				continue
			}
			if cls == "" {
				b.WriteString(html.EscapeString(part))
			} else {
				fmt.Fprintf(&b, `<span class="%s">%s</span>`, cls, html.EscapeString(part))
			}
		}
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	if len(out) != len(text) {
		return nil, fmt.Errorf("%s: highlighted %d lines, want %d", path, len(out), len(text))
	}
	return out, nil
}

func class(t chroma.TokenType) string {
	switch {
	case t.InCategory(chroma.Comment):
		return "tc"
	case t == chroma.KeywordType || t == chroma.NameClass || t == chroma.NameBuiltin:
		return "tt"
	case t.InCategory(chroma.Keyword):
		return "tk"
	case t.InSubCategory(chroma.LiteralString):
		return "ts"
	case t.InSubCategory(chroma.LiteralNumber):
		return "tn"
	case t == chroma.NameFunction || t == chroma.NameFunctionMagic:
		return "tf"
	case t == chroma.NameAttribute || t == chroma.NameDecorator || t == chroma.NameLabel:
		return "ta"
	}
	return ""
}
