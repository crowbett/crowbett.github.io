// Records the compiler version for the ping answer.
fn main() {
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let out = std::process::Command::new(rustc)
        .arg("-V")
        .output()
        .expect("rustc -V");
    let v = String::from_utf8(out.stdout).expect("utf-8");
    println!(
        "cargo:rustc-env=SMOKE_RUSTC={}",
        v.split_whitespace().nth(1).unwrap_or("unknown")
    );
}
