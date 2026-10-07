mod parent_watch;

use polymarket_runtime::{
    decode_and_execute,
    protocol::{ProtocolError, Response, MAX_REQUEST_BYTES},
};
use std::io::{self, BufRead, Read, Write};

fn serve() -> io::Result<()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    loop {
        let mut line = Vec::new();
        let read = (&mut input)
            .take((MAX_REQUEST_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if read == 0 {
            return Ok(());
        }
        if line.len() > MAX_REQUEST_BYTES {
            let response = Response::failed(
                None,
                ProtocolError::invalid_request("Request exceeds native input limit"),
            );
            serde_json::to_writer(&mut output, &response)?;
            output.write_all(b"\n")?;
            output.flush()?;
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Request exceeds native input limit",
            ));
        }
        let response = decode_and_execute(&line);
        serde_json::to_writer(&mut output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!(
            "polymarket-runtime {} protocol={}",
            env!("CARGO_PKG_VERSION"),
            polymarket_runtime::protocol::VERSION
        );
        return;
    }
    if args == ["--parent-watch-fd", "3"] {
        if parent_watch::start().is_err() {
            eprintln!("Native parent watchdog initialization failed");
            std::process::exit(2);
        }
    } else if !args.is_empty() {
        eprintln!("Usage: polymarket-runtime [--version | --parent-watch-fd 3]; JSON-line requests are read from stdin");
        std::process::exit(2);
    }
    if serve().is_err() {
        eprintln!("Native protocol stream failed");
        std::process::exit(1);
    }
}
