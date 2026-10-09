//! File and stream I/O rules of the binary: absolute local paths only (G3),
//! the 64 MiB document cap (G9), atomic output files (G4) and the stdout
//! document (G1, G8).

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::EngineError;

/// Largest stdin document or stdout document (20 G9).
pub const DOCUMENT_CAP_BYTES: usize = 64 << 20;

/// Checks that `p` is an absolute local path (20 G3, 21 §5.1): `r2://` and
/// every other URL scheme, relative paths, empty paths and NUL bytes are
/// `invalid_input: path`.
pub fn local_abs_path(p: &str, what: &str) -> Result<PathBuf, EngineError> {
    if p.is_empty() {
        return Err(EngineError::invalid_input(
            "path",
            format!("{what} is empty"),
        ));
    }
    if p.contains("://") {
        return Err(EngineError::invalid_input(
            "path",
            format!("{what} {p:?} is a URL; the binary reads local absolute paths only (20 G3)"),
        ));
    }
    if p.contains('\0') {
        return Err(EngineError::invalid_input(
            "path",
            format!("{what} contains a NUL byte"),
        ));
    }
    let path = Path::new(p);
    if !path.is_absolute() {
        return Err(EngineError::invalid_input(
            "path",
            format!("{what} {p:?} is relative; the binary takes absolute paths only (20 G3)"),
        ));
    }
    Ok(path.to_path_buf())
}

/// Reads a whole stream, refusing more than `cap` bytes (20 G9).
pub fn read_capped(mut r: impl Read, cap: usize, what: &str) -> Result<Vec<u8>, EngineError> {
    let mut buf = Vec::new();
    let limit = cap as u64 + 1;
    (&mut r)
        .take(limit)
        .read_to_end(&mut buf)
        .map_err(|e| EngineError::runtime("io", format!("reading {what}: {e}")))?;
    if buf.len() > cap {
        return Err(EngineError::invalid_input(
            "schema",
            format!("{what} is larger than {cap} bytes (20 G9)"),
        ));
    }
    Ok(buf)
}

/// Reads a named local file with the document cap. An absent file is
/// `invalid_input: path` (a CLI argument, not a market input).
pub fn read_document_file(path: &Path, what: &str) -> Result<Vec<u8>, EngineError> {
    let f = File::open(path).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => {
            EngineError::invalid_input("path", format!("{what} {} does not exist", path.display()))
        }
        _ => EngineError::runtime("io", format!("opening {what} {}: {e}", path.display())),
    })?;
    read_capped(f, DOCUMENT_CAP_BYTES, what)
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// An output file written atomically (20 G4, 22 §3.1): bytes go to a temp
/// file in the target's directory, [`AtomicFile::commit`] renames it into
/// place, and dropping it uncommitted removes the temp file.
#[derive(Debug)]
pub struct AtomicFile {
    target: PathBuf,
    temp: PathBuf,
    file: Option<File>,
}

impl AtomicFile {
    /// Creates the temp file next to `target`. The directory must exist.
    pub fn create(target: &Path) -> io::Result<AtomicFile> {
        let dir = target.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "output path has no parent")
        })?;
        let name = target
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "output path has no name"))?
            .to_string_lossy()
            .into_owned();
        let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp = dir.join(format!(".{name}.tmp-{}-{n}", std::process::id()));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        Ok(AtomicFile {
            target: target.to_path_buf(),
            temp,
            file: Some(file),
        })
    }

    /// The final path.
    pub fn target(&self) -> &Path {
        &self.target
    }

    /// Takes the open temp file handle (for wrapping in encoders). The
    /// handle must be closed before [`AtomicFile::commit`].
    pub fn take_file(&mut self) -> Option<File> {
        self.file.take()
    }

    /// Renames the temp file onto the target.
    pub fn commit(mut self) -> io::Result<()> {
        if let Some(f) = self.file.take() {
            f.sync_data()?;
        }
        std::fs::rename(&self.temp, &self.target)?;
        // Committed: nothing to remove on drop.
        self.temp = PathBuf::new();
        Ok(())
    }
}

impl Drop for AtomicFile {
    fn drop(&mut self) {
        if !self.temp.as_os_str().is_empty() {
            let _ = std::fs::remove_file(&self.temp);
        }
    }
}

/// Writes `bytes` atomically to `target`.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut f = AtomicFile::create(target)?;
    let mut file = f.take_file().expect("fresh atomic file has a handle");
    file.write_all(bytes)?;
    file.sync_data()?;
    drop(file);
    f.commit()
}

/// Writes the one stdout document plus a newline (20 G1). A closed stdout
/// (EPIPE) is returned as an error; the caller exits (20 G8).
pub fn write_stdout_document(doc: &str) -> io::Result<()> {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    lock.write_all(doc.as_bytes())?;
    lock.write_all(b"\n")?;
    lock.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "pmb-runtime-io-{name}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn path_rules_refuse_urls_and_relative_paths() {
        // spec: 20 G3, 21 §5.1 (absolute local paths; r2:// and relative → invalid_input: path)
        for bad in [
            "r2://bucket/x.parquet",
            "https://x/y",
            "data/x.parquet",
            "./x",
            "",
        ] {
            let e = local_abs_path(bad, "input").unwrap_err();
            assert_eq!(e.cause, "path", "{bad}");
            assert_eq!(e.exit_code(), 2);
        }
        assert!(local_abs_path("/abs/x.parquet", "input").is_ok());
    }

    #[test]
    fn capped_read_refuses_oversize_documents() {
        // spec: 20 G9 (64 MiB cap; smaller cap here)
        assert_eq!(read_capped(&b"abcd"[..], 4, "x").unwrap(), b"abcd");
        let e = read_capped(&b"abcde"[..], 4, "x").unwrap_err();
        assert_eq!(e.exit_code(), 2);
    }

    #[test]
    fn atomic_write_renames_and_cleans_up() {
        // spec: 20 G4, 22 §3.1 (temp file in the same directory, then rename)
        let d = scratch("atomic");
        let target = d.join("out.json");
        write_atomic(&target, b"{}").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"{}");
        let names: Vec<_> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap()).collect();
        assert_eq!(names.len(), 1, "no temp file left behind");

        // Uncommitted: the target never appears and the temp file is removed.
        let target2 = d.join("never.json");
        {
            let mut f = AtomicFile::create(&target2).unwrap();
            f.take_file().unwrap().write_all(b"partial").unwrap();
        }
        assert!(!target2.exists());
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
