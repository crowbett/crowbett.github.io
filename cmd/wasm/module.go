package main

import (
	"bytes"
	"debug/gosym"
	"errors"
	"fmt"
)

// module is what trees needs from a wasm binary.
type module struct {
	sections  []section
	imports   int            // imported functions, which come first in the index space
	exports   map[int]string // function index -> export name
	bodies    []int          // each code body's bytes, its size prefix included
	bodyBytes int
	code      []byte         // the code section's contents
	names     map[int]string // function index -> name, from the name section
	data      []segment      // active data segments
}

type segment struct {
	at  int
	buf []byte
}

type section struct {
	id   byte
	size int // id byte, size prefix and contents
	name string
}

func (s section) label() string {
	if s.id == 0 {
		return "Custom section " + s.name
	}
	if l, ok := map[byte]string{1: "Types", 2: "Imports", 3: "Function list", 4: "Tables", 5: "Memory", 6: "Globals", 7: "Exports", 8: "Start", 9: "Elements", 12: "Data count", 13: "Tags"}[s.id]; ok {
		return l
	}
	return fmt.Sprintf("Section %d", s.id)
}

func parseModule(b []byte) (*module, error) {
	if len(b) < 8 || !bytes.Equal(b[:8], []byte("\x00asm\x01\x00\x00\x00")) {
		return nil, errors.New("not a wasm module")
	}
	m := &module{exports: map[int]string{}, names: map[int]string{}}
	for p := b[8:]; len(p) > 0; {
		id := p[0]
		size, n := uleb(p[1:])
		if n == 0 || uint64(len(p)-1-n) < size {
			return nil, errors.New("truncated section")
		}
		body := p[1+n : 1+n+int(size)]
		s := section{id: id, size: 1 + n + int(size)}
		p = p[s.size:]
		r := &reader{b: body}
		switch id {
		case 0:
			s.name = r.name()
			if s.name == "name" {
				m.readNames(r)
			}
		case 2:
			for range r.count() {
				r.name()
				r.name()
				switch r.byte() {
				case 0:
					r.u()
					m.imports++
				case 1:
					r.byte()
					r.limits()
				case 2:
					r.limits()
				case 3:
					r.byte()
					r.byte()
				case 4:
					r.byte()
					r.u()
				}
			}
		case 7:
			for range r.count() {
				name := r.name()
				kind := r.byte()
				idx := int(r.u())
				if kind == 0 {
					m.exports[idx] = name
				}
			}
		case 11:
			for range r.count() {
				flags := r.u()
				if flags == 2 {
					r.u()
				}
				at := -1
				if flags != 1 {
					if r.byte() == 0x41 { // i32.const
						at = int(r.s())
					}
					for r.i < len(r.b) && r.b[r.i] != 0x0b {
						r.i++
					}
					r.i++
				}
				l := int(r.u())
				if r.i+l > len(r.b) {
					r.err = true
					break
				}
				if at >= 0 {
					m.data = append(m.data, segment{at, r.b[r.i : r.i+l]})
				}
				r.i += l
			}
		case 10:
			m.code = body
			for range r.count() {
				start := r.i
				l := int(r.u())
				r.i += l
				m.bodies = append(m.bodies, r.i-start)
				m.bodyBytes += r.i - start
			}
		}
		if r.err {
			return nil, fmt.Errorf("malformed section %d", id)
		}
		m.sections = append(m.sections, s)
	}
	return m, nil
}

func (m *module) readNames(r *reader) {
	for r.i < len(r.b) && !r.err {
		sub := r.byte()
		l := int(r.u())
		end := r.i + l
		if sub == 1 {
			for range r.count() {
				idx := int(r.u())
				m.names[idx] = r.name()
			}
		}
		r.i = end
	}
}

type reader struct {
	b   []byte
	i   int
	err bool
}

func (r *reader) byte() byte {
	if r.i >= len(r.b) {
		r.err = true
		return 0
	}
	r.i++
	return r.b[r.i-1]
}

func (r *reader) u() uint64 {
	if r.i > len(r.b) {
		r.err = true
		return 0
	}
	v, n := uleb(r.b[r.i:])
	if n == 0 {
		r.err = true
	}
	r.i += n
	return v
}

// count reads an item count. Every item takes at least a byte, so a count past
// the bytes left is corrupt, and looping on it would spin.
func (r *reader) count() int {
	v := r.u()
	if v > uint64(len(r.b)-r.i) {
		r.err = true
		return 0
	}
	return int(v)
}

func (r *reader) s() int64 {
	var v int64
	var shift uint
	for {
		c := r.byte()
		v |= int64(c&0x7f) << shift
		shift += 7
		if c < 0x80 || r.err {
			if shift < 64 && c&0x40 != 0 {
				v |= -1 << shift
			}
			return v
		}
	}
}

func (r *reader) name() string {
	l := int(r.u())
	if r.err || r.i+l > len(r.b) {
		r.err = true
		return ""
	}
	r.i += l
	return string(r.b[r.i-l : r.i])
}

func (r *reader) limits() {
	if r.byte()&1 == 1 {
		r.u()
	}
	r.u()
}

// goNames reads Go's own function table (pclntab) from the data segments.
// Its entry for function i (not counting imports) is 0x1000+i. Go's wasm
// linker escapes the name section's names; this table keeps them as the
// source spells them, and it ships in the published binary.
func (m *module) goNames() (map[int]string, error) {
	end := 0
	for _, s := range m.data {
		end = max(end, s.at+len(s.buf))
	}
	if end > 1<<30 {
		return nil, errors.New("data segments reach past 1 GiB")
	}
	mem := make([]byte, end) // the segments in place, with the zeros the linker left out
	for _, s := range m.data {
		copy(mem[s.at:], s.buf)
	}
	magic := []byte{0xf1, 0xff, 0xff, 0xff, 0, 0, 1, 8}
	if at := bytes.Index(mem, magic); at >= 0 {
		t, err := gosym.NewTable(nil, gosym.NewLineTable(mem[at:], 0))
		if err != nil {
			return nil, fmt.Errorf("pclntab: %w", err)
		}
		names := map[int]string{}
		for _, f := range t.Funcs {
			names[m.imports+int(f.Entry)-0x1000] = f.Name
		}
		return names, nil
	}
	return nil, errors.New("no Go function table in the data segments")
}
