//! Input files of a job and their verification before replay (15 I-3,
//! I-8, I-9; 20 §4.1).
//!
//! The binary checks every input file again even though the TS shim already
//! did: `bytes` always, `sha256` when the job carries one. The file is read
//! with one whole-file read (16 DC-1) and the hash, when needed, is one pass
//! over that buffer. Hashes are memoized per process by
//! `(device, inode, bytes, mtime)` (I-9), so candidate groups and repeated
//! jobs on the same file never hash it twice.

use crate::error::{ErrorClass, InputError};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::path::Path;
use std::sync::Mutex;

/// `format` of a job input (`{name, version}`, 15 I-8, I-13; 21 §5).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct InputFormat<'a> {
    pub name: &'a str,
    pub version: u32,
}

/// One input file as the job names it (`market.input`, 15 §9, 21 §5).
#[derive(Copy, Clone, Debug)]
pub struct InputFile<'a> {
    /// Absolute local path (I-3, I-7).
    pub path: &'a Path,
    /// Expected size in bytes; always checked (I-8).
    pub bytes: u64,
    /// Expected sha256 as 64 lowercase hex digits, or `None` while unknown
    /// (telonex v1 today, 15 I-14). Checked when present (I-8).
    pub sha256: Option<&'a str>,
    pub format: InputFormat<'a>,
}

/// An opened input file whose size matched the job (I-8). The caller
/// reads the whole file (16 DC-1) and passes the buffer to
/// [`Opened::verify_sha256`].
pub(crate) struct Opened {
    pub file: File,
    pub len: usize,
    key: Option<FileKey>,
    want_sha: Option<[u8; 32]>,
}

/// Process-wide memo of file hashes (I-9).
static HASHES: Mutex<BTreeMap<FileKey, [u8; 32]>> = Mutex::new(BTreeMap::new());

/// Identity of one file version on this host (I-9).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct FileKey {
    dev: u64,
    ino: u64,
    bytes: u64,
    mtime_s: i64,
    mtime_ns: i64,
}

#[cfg(unix)]
fn file_key(meta: &std::fs::Metadata) -> Option<FileKey> {
    use std::os::unix::fs::MetadataExt;
    Some(FileKey {
        dev: meta.dev(),
        ino: meta.ino(),
        bytes: meta.len(),
        mtime_s: meta.mtime(),
        mtime_ns: meta.mtime_nsec(),
    })
}

#[cfg(not(unix))]
fn file_key(_meta: &std::fs::Metadata) -> Option<FileKey> {
    None
}

/// Parses 64 lowercase hex digits (the contract's `Sha256Hex`).
fn parse_sha256(hex: &str) -> Option<[u8; 32]> {
    let b = hex.as_bytes();
    if b.len() != 64 {
        return None;
    }
    let nibble = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = (nibble(b[2 * i])? << 4) | nibble(b[2 * i + 1])?;
    }
    Some(out)
}

fn hex(d: &[u8; 32]) -> String {
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether this process holds a memoized hash for the file at `path` in
/// its current version (I-9; test and tooling helper).
#[doc(hidden)]
pub fn hash_memoized(path: &Path) -> bool {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| file_key(&m))
        .is_some_and(|k| {
            HASHES
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .contains_key(&k)
        })
}

/// The sha256 of `buf`, memoized under `key` (I-9).
fn sha256_of(key: Option<FileKey>, buf: &[u8]) -> [u8; 32] {
    let memo = |k: &FileKey| {
        HASHES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(k)
            .copied()
    };
    if let Some(d) = key.as_ref().and_then(memo) {
        return d;
    }
    let d: [u8; 32] = Sha256::digest(buf).into();
    if let Some(k) = key {
        HASHES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(k, d);
    }
    d
}

/// Opens and size-checks one input file (15 I-3, I-8).
///
/// - relative path: `invalid_input: path`;
/// - malformed job sha256: `invalid_input: schema`;
/// - absent file: `data_missing: input_missing`;
/// - size differs from the job: `data_defect: integrity_mismatch`;
/// - other I/O failures: `runtime: io`.
pub(crate) fn open(file: &InputFile<'_>) -> Result<Opened, InputError> {
    let path = file.path;
    if !path.is_absolute() {
        return Err(InputError::new(
            ErrorClass::InvalidInput,
            "path",
            format!("{} is not absolute", path.display()),
        ));
    }
    let want_sha = match file.sha256 {
        None => None,
        Some(h) => Some(parse_sha256(h).ok_or_else(|| {
            InputError::new(
                ErrorClass::InvalidInput,
                "schema",
                format!("input sha256 {h:?} is not 64 lowercase hex digits"),
            )
        })?),
    };
    let f = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(InputError::new(
                ErrorClass::DataMissing,
                "input_missing",
                path.display().to_string(),
            ))
        }
        Err(e) => return Err(io_error(path, &e)),
    };
    let meta = f.metadata().map_err(|e| io_error(path, &e))?;
    if meta.len() != file.bytes {
        return Err(mismatch(
            path,
            format!("{} bytes, the job says {}", meta.len(), file.bytes),
        ));
    }
    let len = usize::try_from(file.bytes).map_err(|_| mismatch(path, "file too large".into()))?;
    Ok(Opened {
        file: f,
        len,
        key: file_key(&meta),
        want_sha,
    })
}

pub(crate) fn io_error(path: &Path, e: &dyn std::fmt::Display) -> InputError {
    InputError::new(
        ErrorClass::Runtime,
        "io",
        format!("{}: {e}", path.display()),
    )
}

fn mismatch(path: &Path, detail: String) -> InputError {
    InputError::new(
        ErrorClass::DataDefect,
        "integrity_mismatch",
        format!("{}: {detail}", path.display()),
    )
}

impl Opened {
    /// Checks the whole-file buffer against the job's sha256 when it has
    /// one (I-8), hashing at most once per file version and process (I-9).
    /// Returns whether the sha256 was verified: a later decode failure is
    /// then `data_defect: corrupt`, else `runtime: decode_unverified`.
    pub fn verify_sha256(&self, path: &Path, buf: &[u8]) -> Result<bool, InputError> {
        let Some(want) = self.want_sha else {
            return Ok(false);
        };
        let got = sha256_of(self.key, buf);
        if got != want {
            return Err(mismatch(
                path,
                format!("sha256 {}, the job says {}", hex(&got), hex(&want)),
            ));
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_round_trip() {
        let d: [u8; 32] = Sha256::digest(b"abc").into();
        let h = hex(&d);
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(parse_sha256(&h), Some(d));
        assert_eq!(parse_sha256(&h.to_uppercase()), None);
        assert_eq!(parse_sha256(&h[1..]), None);
    }
}
