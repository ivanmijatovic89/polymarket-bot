//! Embeds the compiler version and the Cargo profile, which `pmb-tape bench`
//! records with every measurement (16 §13.5). Nothing else is embedded: no
//! time, host, user, path or commit (31 §4.2).

fn main() {
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let version = std::process::Command::new(rustc)
        .arg("-V")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=PMB_TAPE_RUSTC={version}");
    for key in ["PROFILE", "OPT_LEVEL", "DEBUG"] {
        let v = std::env::var(key).unwrap_or_default();
        println!("cargo:rustc-env=PMB_TAPE_BUILD_{key}={v}");
    }
    println!("cargo:rerun-if-changed=build.rs");
}
