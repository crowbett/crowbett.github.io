//! The pipeline's Rust demo: it proves that a Rust binary loads in the worker,
//! speaks the bridge ABI and answers calls (docs/demo-contract.md).

use serde_json::{Value, json};
use std::alloc::{Layout, alloc, dealloc, handle_alloc_error};

fn handle(method: &str, params: &[u8]) -> Value {
    match method {
        "ping" => match serde_json::from_slice::<Value>(params) {
            Ok(p) => json!({ "rust": env!("SMOKE_RUSTC"), "echo": p["echo"] }),
            Err(e) => json!({ "error": format!("params: {e}") }),
        },
        // e2e: a call that never returns
        "hang" => loop {
            std::hint::spin_loop();
        },
        // e2e: a crash inside the bridge
        "panic" => panic!("smoke-rs: deliberate panic"),
        _ => json!({ "error": format!("unknown method {method}") }),
    }
}

/// Bridge ABI: the worker copies its strings in with `demo_alloc`, calls
/// `demo_call`, and reads back a 4-byte little-endian length followed by that
/// many bytes of JSON, then hands every buffer back to `demo_free`.
#[unsafe(no_mangle)]
pub extern "C" fn demo_alloc(len: usize) -> *mut u8 {
    let layout = Layout::from_size_align(len.max(1), 1).unwrap();
    let p = unsafe { alloc(layout) };
    if p.is_null() {
        handle_alloc_error(layout);
    }
    p
}

/// # Safety
/// `ptr` and `len` must come from `demo_alloc` or `demo_call`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn demo_free(ptr: *mut u8, len: usize) {
    unsafe { dealloc(ptr, Layout::from_size_align(len.max(1), 1).unwrap()) }
}

/// # Safety
/// Both ranges must be live buffers from `demo_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn demo_call(
    method: *const u8,
    method_len: usize,
    params: *const u8,
    params_len: usize,
) -> *mut u8 {
    let method = unsafe { std::slice::from_raw_parts(method, method_len) };
    let params = unsafe { std::slice::from_raw_parts(params, params_len) };
    let out = match std::str::from_utf8(method) {
        Ok(m) => handle(m, params).to_string(),
        Err(_) => r#"{"error":"method is not UTF-8"}"#.to_string(),
    };
    let len = out.len();
    let p = demo_alloc(len + 4);
    unsafe {
        p.copy_from_nonoverlapping((len as u32).to_le_bytes().as_ptr(), 4);
        p.add(4).copy_from_nonoverlapping(out.as_ptr(), len);
    }
    p
}
