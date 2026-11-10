// Decodes one function of a WebAssembly binary into text: its signature,
// locals and every instruction with its offset in the file and its bytes.
// Covers the instructions these builds use (MVP, sign extension, saturating
// truncation, bulk memory, reference types, tail calls); it stops, and says
// so, at anything else.
const VAL = { 0x7f: "i32", 0x7e: "i64", 0x7d: "f32", 0x7c: "f64", 0x7b: "v128", 0x70: "funcref", 0x6f: "externref" };
const MEM = "i32.load i64.load f32.load f64.load i32.load8_s i32.load8_u i32.load16_s i32.load16_u i64.load8_s i64.load8_u i64.load16_s i64.load16_u i64.load32_s i64.load32_u i32.store i64.store f32.store f64.store i32.store8 i32.store16 i64.store8 i64.store16 i64.store32".split(" ");
const NUM = ("i32.eqz i32.eq i32.ne i32.lt_s i32.lt_u i32.gt_s i32.gt_u i32.le_s i32.le_u i32.ge_s i32.ge_u " +
  "i64.eqz i64.eq i64.ne i64.lt_s i64.lt_u i64.gt_s i64.gt_u i64.le_s i64.le_u i64.ge_s i64.ge_u " +
  "f32.eq f32.ne f32.lt f32.gt f32.le f32.ge f64.eq f64.ne f64.lt f64.gt f64.le f64.ge " +
  "i32.clz i32.ctz i32.popcnt i32.add i32.sub i32.mul i32.div_s i32.div_u i32.rem_s i32.rem_u i32.and i32.or i32.xor i32.shl i32.shr_s i32.shr_u i32.rotl i32.rotr " +
  "i64.clz i64.ctz i64.popcnt i64.add i64.sub i64.mul i64.div_s i64.div_u i64.rem_s i64.rem_u i64.and i64.or i64.xor i64.shl i64.shr_s i64.shr_u i64.rotl i64.rotr " +
  "f32.abs f32.neg f32.ceil f32.floor f32.trunc f32.nearest f32.sqrt f32.add f32.sub f32.mul f32.div f32.min f32.max f32.copysign " +
  "f64.abs f64.neg f64.ceil f64.floor f64.trunc f64.nearest f64.sqrt f64.add f64.sub f64.mul f64.div f64.min f64.max f64.copysign " +
  "i32.wrap_i64 i32.trunc_f32_s i32.trunc_f32_u i32.trunc_f64_s i32.trunc_f64_u i64.extend_i32_s i64.extend_i32_u i64.trunc_f32_s i64.trunc_f32_u i64.trunc_f64_s i64.trunc_f64_u " +
  "f32.convert_i32_s f32.convert_i32_u f32.convert_i64_s f32.convert_i64_u f32.demote_f64 f64.convert_i32_s f64.convert_i32_u f64.convert_i64_s f64.convert_i64_u f64.promote_f32 " +
  "i32.reinterpret_f32 i64.reinterpret_f64 f32.reinterpret_i32 f64.reinterpret_i64 i32.extend8_s i32.extend16_s i64.extend8_s i64.extend16_s i64.extend32_s").split(" ");
const SAT = "i32.trunc_sat_f32_s i32.trunc_sat_f32_u i32.trunc_sat_f64_s i32.trunc_sat_f64_u i64.trunc_sat_f32_s i64.trunc_sat_f32_u i64.trunc_sat_f64_s i64.trunc_sat_f64_u".split(" ");
const PLAIN = { 0x00: "unreachable", 0x01: "nop", 0x05: "else", 0x0b: "end", 0x0f: "return", 0x1a: "drop", 0x1b: "select", 0xd1: "ref.is_null" };
const VAR = { 0x0c: "br", 0x0d: "br_if", 0x10: "call", 0x12: "return_call", 0x20: "local.get", 0x21: "local.set", 0x22: "local.tee", 0x23: "global.get", 0x24: "global.set", 0x25: "table.get", 0x26: "table.set", 0xd2: "ref.func" };

class Reader {
  constructor(b, i) { this.b = b; this.i = i; }
  byte() {
    if (this.i >= this.b.length) throw new Error("ran past the end of the binary");
    return this.b[this.i++];
  }
  u() {
    let v = 0, mul = 1, c;
    do { c = this.byte(); v += (c & 0x7f) * mul; mul *= 128; } while (c & 0x80);
    return v;
  }
  s(bits) {
    let v = 0n, shift = 0n, c;
    do { c = this.byte(); v |= BigInt(c & 0x7f) << shift; shift += 7n; } while (c & 0x80);
    if (shift < BigInt(bits) && c & 0x40) v -= 1n << shift;
    return v;
  }
  skip(n) { this.i += n; }
  name() { const n = this.u(); const s = new TextDecoder().decode(this.b.subarray(this.i, this.i + n)); this.i += n; return s; }
}

const modules = new WeakMap();

// parse finds the function types, each function's type and each body.
function parse(buf) {
  if (modules.has(buf)) return modules.get(buf);
  const b = new Uint8Array(buf);
  if (b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) throw new Error("not a WebAssembly binary");
  const m = { b, types: [], funcType: [], bodies: [] };
  const r = new Reader(b, 8);
  while (r.i < b.length) {
    const id = r.byte(), size = r.u(), end = r.i + size;
    if (id === 1) {
      for (let n = r.u(); n > 0; n--) {
        r.byte();
        const params = []; for (let k = r.u(); k > 0; k--) params.push(VAL[r.byte()] ?? "?");
        const results = []; for (let k = r.u(); k > 0; k--) results.push(VAL[r.byte()] ?? "?");
        m.types.push({ params, results });
      }
    } else if (id === 2) {
      for (let n = r.u(); n > 0; n--) {
        r.name(); r.name();
        const kind = r.byte();
        if (kind === 0) m.funcType.push(r.u());
        else if (kind === 1) { r.byte(); limits(r); }
        else if (kind === 2) limits(r);
        else if (kind === 3) { r.byte(); r.byte(); }
        else r.u();
      }
      m.imports = m.funcType.length;
    } else if (id === 3) {
      for (let n = r.u(); n > 0; n--) m.funcType.push(r.u());
    } else if (id === 10) {
      for (let n = r.u(); n > 0; n--) {
        const at = r.i, len = r.u();
        m.bodies.push({ at, start: r.i, end: r.i + len });
        r.skip(len);
      }
    }
    r.i = end;
  }
  m.imports ??= 0;
  modules.set(buf, m);
  return m;
}

function limits(r) { const f = r.byte(); r.u(); if (f & 1) r.u(); }

function blockType(r, m) {
  const c = r.b[r.i];
  if (c === 0x40) { r.i++; return ""; }
  if (VAL[c]) { r.i++; return ` (result ${VAL[c]})`; }
  const t = m.types[Number(r.s(33))];
  return t ? sig(t) : "";
}

const sig = (t) => `${t.params.length ? ` (param ${t.params.join(" ")})` : ""}${t.results.length ? ` (result ${t.results.join(" ")})` : ""}`;
const hex = (b, from, to) => {
  const n = Math.min(to - from, 6);
  let s = "";
  for (let k = 0; k < n; k++) s += b[from + k].toString(16).padStart(2, "0") + " ";
  return to - from > 6 ? s + "…" : s.trimEnd();
};

export function disassemble(buf, index, names) {
  const m = parse(buf);
  const body = m.bodies[index - m.imports];
  if (!body) throw new Error(`no function ${index}`);
  const t = m.types[m.funcType[index]] ?? { params: [], results: [] };
  const r = new Reader(m.b, body.start);
  const locals = [];
  for (let n = r.u(); n > 0; n--) {
    const count = r.u(), type = VAL[r.byte()] ?? "?";
    locals.push(count > 1 ? `${type} ×${count}` : type);
  }
  const lines = [];
  let depth = 0, stopped = "";
  const callee = (i) => names?.get(i) ? `${i}  ;; ${names.get(i)}` : String(i);
  while (r.i < body.end) {
    const at = r.i, op = r.byte();
    let text, d = depth;
    if (op in PLAIN) {
      text = PLAIN[op];
      if (op === 0x05) d = depth - 1;
      if (op === 0x0b) d = depth = Math.max(0, depth - 1);
    } else if (op in VAR) {
      const v = r.u();
      text = `${VAR[op]} ${op === 0x10 || op === 0x12 ? callee(v) : v}`;
    } else if (op === 0x02 || op === 0x03 || op === 0x04) {
      text = ["block", "loop", "if"][op - 2] + blockType(r, m);
      depth++;
    } else if (op === 0x0e) {
      const targets = []; for (let n = r.u(); n > 0; n--) targets.push(r.u());
      text = `br_table ${targets.join(" ")} ${r.u()}`;
    } else if (op === 0x11 || op === 0x13) {
      const ty = r.u(), table = r.u();
      text = `${op === 0x11 ? "call_indirect" : "return_call_indirect"}${table ? ` ${table}` : ""} (type ${ty})${m.types[ty] ? sig(m.types[ty]) : ""}`;
    } else if (op === 0x1c) {
      const ts = []; for (let n = r.u(); n > 0; n--) ts.push(VAL[r.byte()]);
      text = `select (result ${ts.join(" ")})`;
    } else if (op >= 0x28 && op <= 0x3e) {
      let align = r.u();
      const mem = align & 0x40 ? r.u() : 0;
      align &= ~0x40;
      const off = r.u();
      text = `${MEM[op - 0x28]}${mem ? ` ${mem}` : ""}${off ? ` offset=${off}` : ""}${align ? ` align=${2 ** align}` : ""}`;
    } else if (op === 0x3f || op === 0x40) {
      r.byte();
      text = op === 0x3f ? "memory.size" : "memory.grow";
    } else if (op === 0x41) text = `i32.const ${r.s(32)}`;
    else if (op === 0x42) text = `i64.const ${r.s(64)}`;
    else if (op === 0x43) { text = `f32.const ${new DataView(m.b.buffer, r.i, 4).getFloat32(0, true)}`; r.skip(4); }
    else if (op === 0x44) { text = `f64.const ${new DataView(m.b.buffer, r.i, 8).getFloat64(0, true)}`; r.skip(8); }
    else if (op >= 0x45 && op <= 0xc4) text = NUM[op - 0x45];
    else if (op === 0xd0) text = `ref.null ${VAL[r.byte()] ?? "?"}`;
    else if (op === 0xfc) {
      const sub = r.u();
      if (sub < 8) text = SAT[sub];
      else if (sub === 8) { text = `memory.init ${r.u()}`; r.byte(); }
      else if (sub === 9) text = `data.drop ${r.u()}`;
      else if (sub === 10) { r.byte(); r.byte(); text = "memory.copy"; }
      else if (sub === 11) { r.byte(); text = "memory.fill"; }
      else if (sub === 12) text = `table.init ${r.u()} ${r.u()}`;
      else if (sub === 13) text = `elem.drop ${r.u()}`;
      else if (sub === 14) text = `table.copy ${r.u()} ${r.u()}`;
      else if (sub >= 15 && sub <= 17) text = `${["table.grow", "table.size", "table.fill"][sub - 15]} ${r.u()}`;
    }
    if (text == null) {
      stopped = `Decoding stops at 0x${at.toString(16)}: opcode 0x${op.toString(16)} is outside what this decoder reads.`;
      break;
    }
    lines.push({ at, hex: hex(m.b, at, r.i), depth: Math.max(0, d), text });
  }
  return { at: body.at, size: body.end - body.at, sig: sig(t).trim() || "(no params or results)", locals: locals.length ? `(local ${locals.join(" ")})` : "", lines, stopped };
}
