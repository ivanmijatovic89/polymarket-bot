//! `cargo run -p job-contract --bin export-schema [-- --check] [-- --contract-dir <dir>]`
//!
//! Writes the JSON Schema bundle `native/contract/schema/v1/*.schema.json`
//! and the hash fixture `native/contract/fixtures/hashes.json` (21 §3), or
//! with `--check` fails when the committed files differ (CI item 1).
//! Unknown arguments are errors (R14).

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut check = false;
    let mut dir = job_contract::schema::default_contract_dir();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--check" => check = true,
            "--contract-dir" => match args.next() {
                Some(d) => dir = PathBuf::from(d),
                None => return usage("--contract-dir needs a value"),
            },
            other => return usage(&format!("unknown argument {other:?}")),
        }
    }
    let result = if check {
        job_contract::schema::check(&dir)
    } else {
        job_contract::schema::write(&dir)
    };
    match result {
        Ok(()) => {
            if check {
                eprintln!("export-schema: committed contract files are up to date");
            }
            ExitCode::SUCCESS
        }
        Err(problems) => {
            eprint!("export-schema: {problems}");
            ExitCode::FAILURE
        }
    }
}

fn usage(msg: &str) -> ExitCode {
    eprintln!("export-schema: {msg}\nusage: export-schema [--check] [--contract-dir <dir>]");
    ExitCode::from(2)
}
