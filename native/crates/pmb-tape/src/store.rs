//! Tape files on disk: path derivation, v1 identity, lookup and validation
//! (NT-1, NT-5), the atomic self-verifying writer (NT-4) and the disk budget
//! (NT-7).

use crate::codec::{self, Decoder, EncodeOptions, TapeError, TapeHeader, V1Identity};
use crate::replay::{ReplayStream, Replayer};
use crate::typed::{dec, TypedRows, Unconvertible};
use crate::v1::read_v1;
use bytes::Bytes;
use pmb_replay::{InputError, TelonexInput};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Directory under the tape root for telonex-delta-typed v1 inputs.
pub const TAPE_DIR: &str = "telonex-delta-typed-v1";
/// Tape file extension.
pub const TAPE_EXT: &str = "pmbtape";
/// Per-host cap on worker-1 (NT-7, gate 1).
pub const DEFAULT_CAP_BYTES: u64 = 40_000_000_000;
/// Free-disk floor kept for fleet data sync and builds (NT-7).
pub const DEFAULT_MIN_FREE_BYTES: u64 = 10_000_000_000;

/// Tape path of a market input (format, symbol, timeframe, slug) under a tape
/// root (NT-5). Every component must be a plain name.
pub fn tape_path(
    tape_root: &Path,
    symbol: &str,
    timeframe: &str,
    slug: &str,
) -> Result<PathBuf, String> {
    for (what, v) in [("symbol", symbol), ("timeframe", timeframe), ("slug", slug)] {
        let plain = !v.is_empty()
            && v != "."
            && v != ".."
            && v.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.');
        if !plain {
            return Err(format!("{what} {v:?} is not a plain path component"));
        }
    }
    Ok(tape_root
        .join(TAPE_DIR)
        .join(symbol)
        .join(timeframe)
        .join(format!("{slug}.{TAPE_EXT}")))
}

/// `(bytes, mtime_ns)` of a file, from `stat`.
pub fn stat_identity(path: &Path) -> std::io::Result<(u64, i64)> {
    let md = fs::metadata(path)?;
    let mtime = md.modified()?;
    let ns = match mtime.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_nanos()).map_err(std::io::Error::other)?,
        Err(e) => -i64::try_from(e.duration().as_nanos()).map_err(std::io::Error::other)?,
    };
    Ok((md.len(), ns))
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn parse_hex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(s.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    Some(out)
}

/// Why the v1 path is used instead of a tape (reported in diagnostics only).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fallback {
    /// No tape at the derived path.
    Missing,
    /// The tape or the v1 file could not be read or stat'ed.
    Io(String),
    /// Unreadable tape: bad magic, unknown version, failed frame or layout.
    Invalid(TapeError),
    /// The tape was built from a different v1 file (bytes, mtime or sha256).
    Stale(String),
}

impl Fallback {
    pub fn label(&self) -> &'static str {
        match self {
            Fallback::Missing => "missing",
            Fallback::Io(_) => "io",
            Fallback::Invalid(TapeError::Version(_)) => "version",
            Fallback::Invalid(_) => "invalid",
            Fallback::Stale(_) => "stale",
        }
    }
}

impl fmt::Display for Fallback {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Fallback::Missing => write!(f, "no tape"),
            Fallback::Io(e) => write!(f, "io: {e}"),
            Fallback::Invalid(e) => write!(f, "invalid tape: {e}"),
            Fallback::Stale(e) => write!(f, "stale tape: {e}"),
        }
    }
}

fn check_identity(
    h: &TapeHeader,
    v1_stat: (u64, i64),
    expected_sha: Option<&[u8; 32]>,
) -> Result<(), Fallback> {
    if h.v1.bytes != v1_stat.0 || h.v1.mtime_ns != v1_stat.1 {
        return Err(Fallback::Stale(format!(
            "tape built from {} bytes / mtime {} ns, v1 is {} / {}",
            h.v1.bytes, h.v1.mtime_ns, v1_stat.0, v1_stat.1
        )));
    }
    if let Some(sha) = expected_sha {
        if &h.v1.sha256 != sha {
            return Err(Fallback::Stale(format!(
                "tape sha256 {} != job sha256 {}",
                hex(&h.v1.sha256),
                hex(sha)
            )));
        }
    }
    Ok(())
}

/// Reads a tape file into the decoder's reused buffer and checks its header
/// against the v1 file (NT-5); `f` gets the buffer and header.
fn with_tape<T>(
    decoder: &mut Decoder,
    tape: &Path,
    v1: &Path,
    expected_sha: Option<&[u8; 32]>,
    f: impl FnOnce(&mut Decoder, &[u8], &TapeHeader) -> Result<T, Fallback>,
) -> Result<T, Fallback> {
    let mut buf = std::mem::take(&mut decoder.file);
    buf.clear();
    let result = (|| {
        match fs::File::open(tape) {
            Ok(mut file) => {
                file.read_to_end(&mut buf)
                    .map_err(|e| Fallback::Io(e.to_string()))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Fallback::Missing),
            Err(e) => return Err(Fallback::Io(e.to_string())),
        }
        let v1_stat = stat_identity(v1).map_err(|e| Fallback::Io(e.to_string()))?;
        let h = decoder.header(&buf).map_err(Fallback::Invalid)?;
        check_identity(&h, v1_stat, expected_sha)?;
        f(decoder, &buf, &h)
    })();
    decoder.file = buf;
    result
}

/// Loads the typed rows of a v1 file from its tape when the tape is usable
/// (NT-5): supported version, matching v1 identity (stat, and the job's
/// sha256 when it carries one) and every frame checksum passing. Any other
/// outcome is a [`Fallback`], never an error.
pub fn load_tape(
    decoder: &mut Decoder,
    tape: &Path,
    v1: &Path,
    expected_sha: Option<&[u8; 32]>,
) -> Result<(TapeHeader, TypedRows), Fallback> {
    with_tape(decoder, tape, v1, expected_sha, |d, buf, h| {
        let rows = d.decode_rows(buf, h).map_err(Fallback::Invalid)?;
        Ok((h.clone(), rows))
    })
}

/// The market stream of a v1 file read from its tape, block by block with
/// reused buffers (the executor path). The outer error is a [`Fallback`]
/// (read v1 instead); the inner one is the reader's own input error, which
/// v1 would raise identically.
pub fn read_tape_stream(
    decoder: &mut Decoder,
    tape: &Path,
    v1: &Path,
    expected_sha: Option<&[u8; 32]>,
    input: &TelonexInput<'_>,
) -> Result<Result<ReplayStream, InputError>, Fallback> {
    with_tape(decoder, tape, v1, expected_sha, |d, buf, h| {
        let mut replayer = match Replayer::new(&h.dict, input) {
            Ok(r) => r,
            Err(e) => return Ok(Err(e)),
        };
        replayer.reserve_counts(
            h.rows as usize,
            (h.list_values[dec::BID_PRICES] + h.list_values[dec::ASK_PRICES]) as usize,
            h.list_values[dec::CHANGE_PRICES] as usize,
        );
        match d
            .stream(buf, h, |rows, row0| replayer.feed(rows, row0))
            .map_err(Fallback::Invalid)?
        {
            Ok(()) => Ok(Ok(replayer.finish())),
            Err(e) => Ok(Err(e)),
        }
    })
}

/// Bytes of every regular file under `dir` (0 when it does not exist).
pub fn dir_bytes(dir: &Path) -> std::io::Result<u64> {
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let mut total = 0;
    for e in rd {
        let e = e?;
        let ft = e.file_type()?;
        if ft.is_dir() {
            total += dir_bytes(&e.path())?;
        } else if ft.is_file() {
            total += e.metadata()?.len();
        }
    }
    Ok(total)
}

/// Available bytes on the filesystem holding `path` (`df -Pk`, no unsafe).
pub fn free_bytes(path: &Path) -> std::io::Result<u64> {
    let out = std::process::Command::new("df")
        .arg("-Pk")
        .arg(path)
        .output()?;
    if !out.status.success() {
        return Err(std::io::Error::other(format!(
            "df -Pk {} failed: {}",
            path.display(),
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let avail_kb = text
        .lines()
        .nth(1)
        .and_then(|l| l.split_whitespace().nth(3))
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| std::io::Error::other(format!("unexpected df output: {text}")))?;
    Ok(avail_kb * 1024)
}

/// Disk budget of one conversion run (NT-7).
#[derive(Clone, Debug)]
pub struct Budget {
    pub cap_bytes: u64,
    pub min_free_bytes: u64,
    /// Bytes currently under the tape root.
    pub used_bytes: u64,
    /// Free bytes at the last `df`, minus what was written since.
    pub free_bytes: u64,
    since_refresh: u32,
    root: PathBuf,
}

/// How often (in written tapes) free disk is re-read with `df`.
const FREE_REFRESH_EVERY: u32 = 32;

impl Budget {
    pub fn new(root: &Path, cap_bytes: u64, min_free_bytes: u64) -> std::io::Result<Self> {
        fs::create_dir_all(root)?;
        Ok(Budget {
            cap_bytes,
            min_free_bytes,
            used_bytes: dir_bytes(root)?,
            free_bytes: free_bytes(root)?,
            since_refresh: 0,
            root: root.to_path_buf(),
        })
    }

    /// Whether `new_bytes` more fit; `Err` names the limit that stops.
    fn admit(&mut self, new_bytes: u64, replaced: u64) -> std::io::Result<Result<(), Stop>> {
        if self.since_refresh >= FREE_REFRESH_EVERY {
            self.free_bytes = free_bytes(&self.root)?;
            self.since_refresh = 0;
        }
        if self.used_bytes.saturating_sub(replaced) + new_bytes > self.cap_bytes {
            return Ok(Err(Stop::Cap));
        }
        if self.free_bytes.saturating_sub(new_bytes) < self.min_free_bytes {
            return Ok(Err(Stop::FreeDisk));
        }
        Ok(Ok(()))
    }

    fn wrote(&mut self, new_bytes: u64, replaced: u64) {
        self.used_bytes = self.used_bytes.saturating_sub(replaced) + new_bytes;
        self.free_bytes = (self.free_bytes + replaced).saturating_sub(new_bytes);
        self.since_refresh += 1;
    }
}

/// A limit that ends a conversion run (NT-7).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Stop {
    Cap,
    FreeDisk,
}

/// Result of converting one v1 file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConvertOutcome {
    Written {
        tape_bytes: u64,
        v1_bytes: u64,
        rows: u64,
        levels: u64,
    },
    /// A valid tape for this exact v1 file already exists.
    SkippedValid {
        tape_bytes: u64,
    },
    /// The file stays on the v1 path (NT-2).
    Unconvertible(Unconvertible),
    /// The v1 file changed while it was converted; nothing written.
    Raced,
    Stopped(Stop),
}

/// Converter settings.
#[derive(Clone, Copy, Debug)]
pub struct ConvertOptions {
    pub encode: EncodeOptions,
    pub tool_sha256: [u8; 32],
}

/// Converts one v1 file to its tape (NT-4): skip if valid, read the whole
/// file once (sha256 and decode from the same bytes), encode, decode the
/// encoded bytes and compare with the typed rows from v1, check the v1 file
/// did not change meanwhile, then write `tmp` and rename.
pub fn convert_one(
    v1: &Path,
    tape: &Path,
    opts: &ConvertOptions,
    budget: &mut Budget,
    decoder: &mut Decoder,
) -> anyhow::Result<ConvertOutcome> {
    use anyhow::{bail, Context};
    let existing = fs::metadata(tape).map(|m| m.len()).unwrap_or(0);
    if existing > 0 && load_tape(decoder, tape, v1, None).is_ok() {
        return Ok(ConvertOutcome::SkippedValid {
            tape_bytes: existing,
        });
    }
    let before = stat_identity(v1).with_context(|| format!("stat {}", v1.display()))?;
    let data = fs::read(v1).with_context(|| format!("read {}", v1.display()))?;
    if data.len() as u64 != before.0 {
        return Ok(ConvertOutcome::Raced);
    }
    let identity = V1Identity {
        bytes: before.0,
        mtime_ns: before.1,
        sha256: sha256(&data),
    };
    let rows = match read_v1(Bytes::from(data)) {
        Ok(r) => r,
        Err(u) => return Ok(ConvertOutcome::Unconvertible(u)),
    };
    let encoded =
        codec::encode(&rows, identity, opts.tool_sha256, &opts.encode).context("encode tape")?;
    let (header, decoded) = decoder
        .decode(&encoded)
        .map_err(|e| anyhow::anyhow!("decode of the fresh tape failed: {e}"))?;
    if decoded != rows || header.v1 != identity {
        bail!(
            "round trip mismatch for {}: the decoded tape differs from the v1 typed rows",
            v1.display()
        );
    }
    if stat_identity(v1)? != before {
        return Ok(ConvertOutcome::Raced);
    }
    let new_bytes = encoded.len() as u64;
    if let Err(stop) = budget.admit(new_bytes, existing)? {
        return Ok(ConvertOutcome::Stopped(stop));
    }
    let dir = tape.parent().context("tape path has no parent")?;
    fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
    let tmp = tape.with_extension(format!("{TAPE_EXT}.tmp.{}", std::process::id()));
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&encoded)?;
        f.sync_all()?;
        fs::rename(&tmp, tape)
    };
    if let Err(e) = write() {
        let _ = fs::remove_file(&tmp);
        return Err(e).with_context(|| format!("write {}", tape.display()));
    }
    budget.wrote(new_bytes, existing);
    Ok(ConvertOutcome::Written {
        tape_bytes: new_bytes,
        v1_bytes: identity.bytes,
        rows: header.rows,
        levels: header.levels(),
    })
}
