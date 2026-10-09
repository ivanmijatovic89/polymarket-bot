//! Tape files on disk: path derivation, v1 identity, lookup and validation
//! (NT-1, NT-5), the atomic self-verifying writer (NT-4) and the disk budget
//! (NT-7).

use crate::codec::{self, Decoder, EncodeOptions, TapeError, TapeHeader, V1Identity};
use crate::replay::{ReplayStream, Replayer};
use crate::typed::{dec, TypedRows, Unconvertible};
use crate::v1::read_v1;
use bytes::Bytes;
use pmb_replay::telonex::{FORMAT_NAME, FORMAT_VERSION};
use pmb_replay::{InputError, InputFile, TelonexInput};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Tape file extension.
pub const TAPE_EXT: &str = "pmbtape";
/// Per-host cap on worker-1 (NT-7, gate 1).
pub const DEFAULT_CAP_BYTES: u64 = 40_000_000_000;
/// Free-disk floor kept for fleet data sync and builds (NT-7).
pub const DEFAULT_MIN_FREE_BYTES: u64 = 10_000_000_000;

/// The job input a tape is derived from (NT-5): the input format named by
/// the job (15 I-13) and the market's symbol, timeframe and slug.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarketKey<'a> {
    pub format: &'a str,
    pub format_version: u32,
    pub symbol: &'a str,
    pub timeframe: &'a str,
    pub slug: &'a str,
}

/// Tape path of a market input under a tape root (NT-1, NT-5):
/// `<root>/<format>-v<format_version>/tape-v<tape format>/<symbol>/<timeframe>/<slug>.pmbtape`.
/// Tapes of different tape format versions, or of different input formats,
/// never share a path. Every component must be a plain name.
pub fn tape_path(tape_root: &Path, key: &MarketKey<'_>) -> Result<PathBuf, String> {
    for (what, v) in [
        ("format", key.format),
        ("symbol", key.symbol),
        ("timeframe", key.timeframe),
        ("slug", key.slug),
    ] {
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
        .join(format!("{}-v{}", key.format, key.format_version))
        .join(format!("tape-v{}", codec::FORMAT_VERSION))
        .join(key.symbol)
        .join(key.timeframe)
        .join(format!("{}.{TAPE_EXT}", key.slug)))
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
    /// The job's input facts (format, bytes, sha256) are ones the v1 reader
    /// refuses; v1 raises that error (15 I-8, I-13).
    Job(String),
}

impl Fallback {
    pub fn label(&self) -> &'static str {
        match self {
            Fallback::Missing => "missing",
            Fallback::Io(_) => "io",
            Fallback::Invalid(TapeError::Version(_)) => "version",
            Fallback::Invalid(_) => "invalid",
            Fallback::Stale(_) => "stale",
            Fallback::Job(_) => "job",
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
            Fallback::Job(e) => write!(f, "job input: {e}"),
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

/// Checks the job's input facts that the v1 reader verifies before decoding
/// (15 I-8, I-13): the supported format, the file size, and the sha256 in
/// its contract form (64 lowercase hex digits). Returns the sha256 a tape
/// must carry, if any; a refusal is a [`Fallback::Job`], so v1 raises the
/// reader's own error.
pub fn check_job(file: &InputFile<'_>) -> Result<Option<[u8; 32]>, Fallback> {
    if file.format.name != FORMAT_NAME || file.format.version != FORMAT_VERSION {
        return Err(Fallback::Job(format!(
            "format {:?} version {}",
            file.format.name, file.format.version
        )));
    }
    let sha = match file.sha256 {
        None => None,
        Some(h) => {
            let lower = h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
            match parse_hex32(h).filter(|_| lower) {
                Some(d) => Some(d),
                None => return Err(Fallback::Job(format!("sha256 {h:?}"))),
            }
        }
    };
    let (bytes, _) = stat_identity(file.path).map_err(|e| Fallback::Io(e.to_string()))?;
    if bytes != file.bytes {
        return Err(Fallback::Job(format!(
            "v1 has {bytes} bytes, the job says {}",
            file.bytes
        )));
    }
    Ok(sha)
}

/// Checks a parsed tape header against the v1 file's `stat` and, when
/// given, the expected sha256 (NT-5).
pub fn check_tape_identity(
    h: &TapeHeader,
    v1: &Path,
    expected_sha: Option<&[u8; 32]>,
) -> Result<(), Fallback> {
    let v1_stat = stat_identity(v1).map_err(|e| Fallback::Io(e.to_string()))?;
    check_identity(h, v1_stat, expected_sha)
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
        let mut replayer = Replayer::new(&h.dict, input, v1);
        // `parse_meta` checked these counts against the blocks; the sum and
        // the reservation still fail softly into a fallback (NT-5).
        let counts = (|| {
            let book =
                h.list_values[dec::BID_PRICES].checked_add(h.list_values[dec::ASK_PRICES])?;
            Some((
                usize::try_from(h.rows).ok()?,
                usize::try_from(book).ok()?,
                usize::try_from(h.list_values[dec::CHANGE_PRICES]).ok()?,
            ))
        })();
        let Some((rows, book, changes)) = counts else {
            return Err(Fallback::Invalid(TapeError::Layout(
                "level counts overflow".into(),
            )));
        };
        replayer
            .reserve_counts(rows, book, changes)
            .map_err(|e| Fallback::Invalid(TapeError::Layout(format!("reserve: {e}"))))?;
        match d
            .stream(buf, h, |rows, row0| replayer.feed(rows, row0))
            .map_err(Fallback::Invalid)?
        {
            Ok(()) => Ok(Ok(replayer.finish())),
            Err(e) => Ok(Err(e)),
        }
    })
}

/// Resolves `p` through symlinks: its nearest existing ancestor is
/// canonicalized and the remaining components, which must be plain names,
/// are appended.
pub fn resolve_lenient(p: &Path) -> Result<PathBuf, String> {
    let mut existing = p;
    let mut rest = Vec::new();
    loop {
        match fs::canonicalize(existing) {
            Ok(mut out) => {
                out.extend(rest.iter().rev());
                return Ok(out);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let name = match existing.components().next_back() {
                    Some(std::path::Component::Normal(n)) => n,
                    _ => return Err(format!("{} is not a plain path", p.display())),
                };
                rest.push(name);
                existing = existing
                    .parent()
                    .ok_or_else(|| format!("{} has no existing ancestor", p.display()))?;
            }
            Err(e) => return Err(format!("resolve {}: {e}", existing.display())),
        }
    }
}

/// The git working copy holding `p` (the nearest ancestor with a `.git`).
fn working_copy(p: &Path) -> Option<PathBuf> {
    p.ancestors()
        .find(|a| a.join(".git").exists())
        .map(Path::to_path_buf)
}

/// Checks that a tape root is safe to write (NT-8, 01 §8.1 H2) and returns
/// it resolved. The root must not lie inside (or contain) the resolved
/// data-root subtree of any input file, which on worker-1 is a read-only
/// link into the fleet copy, nor inside (or contain) another git working
/// copy that holds inputs (the fleet copy itself).
pub fn check_tape_root(
    tape_root: &Path,
    data_root: &Path,
    inputs: &[PathBuf],
) -> Result<PathBuf, String> {
    let root = resolve_lenient(tape_root)?;
    let data = fs::canonicalize(data_root)
        .map_err(|e| format!("data root {}: {e}", data_root.display()))?;
    let own = working_copy(&data);
    let mut protected: Vec<(PathBuf, String)> = Vec::new();
    for input in inputs {
        let first = input
            .strip_prefix(data_root)
            .ok()
            .and_then(|r| r.components().next())
            .ok_or_else(|| {
                format!(
                    "input {} is not under the data root {}",
                    input.display(),
                    data_root.display()
                )
            })?;
        let child = data_root.join(first);
        let subtree =
            fs::canonicalize(&child).map_err(|e| format!("input root {}: {e}", child.display()))?;
        if let Some(wc) = working_copy(&subtree).filter(|wc| Some(wc) != own.as_ref()) {
            let why = format!("working copy {} that holds the inputs", wc.display());
            protected.push((wc, why));
        }
        let why = format!("input tree {} (via {})", subtree.display(), child.display());
        protected.push((subtree, why));
    }
    for (p, why) in &protected {
        if root.starts_with(p) || p.starts_with(&root) {
            return Err(format!(
                "tape root {} (resolved {}) overlaps the {why}; tapes are written only under the checkout's own tape root (16 NT-8)",
                tape_root.display(),
                root.display()
            ));
        }
    }
    Ok(root)
}

/// Whether `name` is a converter's temporary file (`<slug>.pmbtape.tmp.<pid>`);
/// returns the pid.
fn tmp_pid(name: &str) -> Option<u32> {
    let (_, pid) = name.split_once(&format!(".{TAPE_EXT}.tmp."))?;
    pid.parse().ok()
}

fn pid_alive(pid: u32) -> bool {
    pid == std::process::id()
        || std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "pid="])
            .output()
            .is_ok_and(|o| o.status.success())
}

/// Removes temporary files left under `root` by converters that died
/// between create and rename (their pid is gone). Returns (removed, bytes).
pub fn sweep_stale_tmp(root: &Path) -> std::io::Result<(u32, u64)> {
    let rd = match fs::read_dir(root) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(e) => return Err(e),
    };
    let (mut n, mut bytes) = (0, 0);
    for e in rd {
        let e = e?;
        let ft = e.file_type()?;
        if ft.is_dir() {
            let (dn, db) = sweep_stale_tmp(&e.path())?;
            n += dn;
            bytes += db;
        } else if ft.is_file() {
            let name = e.file_name();
            if let Some(pid) = name.to_str().and_then(tmp_pid) {
                if !pid_alive(pid) {
                    bytes += e.metadata()?.len();
                    fs::remove_file(e.path())?;
                    n += 1;
                }
            }
        }
    }
    Ok((n, bytes))
}

/// Bytes of every tape file under `dir` (0 when it does not exist);
/// in-flight temporary files are not tapes and are not counted.
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
        } else if ft.is_file() && e.file_name().to_str().and_then(tmp_pid).is_none() {
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
    /// The file at the tape path has a newer tape format than this tool
    /// writes; it is left alone.
    NewerFormat(u32),
    /// The file stays on the v1 path (NT-2).
    Unconvertible(Unconvertible),
    /// The v1 file changed while it was converted; nothing written.
    Raced,
    /// The v1 file is not the expected one (bytes or sha256 differ from the
    /// frozen manifest, 16 §13.1); nothing written.
    SourceChanged {
        bytes: u64,
        sha256: [u8; 32],
    },
    Stopped(Stop),
}

/// Converter settings.
#[derive(Clone, Copy, Debug)]
pub struct ConvertOptions {
    pub encode: EncodeOptions,
    pub tool_sha256: [u8; 32],
}

/// The identity a caller expects of a v1 file (a frozen bench manifest's
/// bytes and sha256, 16 §13.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExpectedSource {
    pub bytes: u64,
    pub sha256: [u8; 32],
}

/// Converts one v1 file to its tape (NT-4): skip if valid, read the whole
/// file once (sha256 and decode from the same bytes), refuse a file that
/// is not the `expected` one, encode, decode the encoded bytes and compare
/// with the typed rows from v1, check the v1 file did not change
/// meanwhile, then write `tmp` and rename.
pub fn convert_one(
    v1: &Path,
    tape: &Path,
    expected: Option<&ExpectedSource>,
    opts: &ConvertOptions,
    budget: &mut Budget,
    decoder: &mut Decoder,
) -> anyhow::Result<ConvertOutcome> {
    convert_one_hooked(v1, tape, expected, opts, budget, decoder, &mut || {})
}

/// [`convert_one`] with a hook run after the v1 bytes were read (tests use
/// it to change the file mid-conversion).
pub(crate) fn convert_one_hooked(
    v1: &Path,
    tape: &Path,
    expected: Option<&ExpectedSource>,
    opts: &ConvertOptions,
    budget: &mut Budget,
    decoder: &mut Decoder,
    after_read: &mut dyn FnMut(),
) -> anyhow::Result<ConvertOutcome> {
    use anyhow::{bail, Context};
    let existing = fs::metadata(tape).map(|m| m.len()).unwrap_or(0);
    if existing > 0 {
        match load_tape(decoder, tape, v1, expected.map(|e| &e.sha256)) {
            Ok(_) => {
                return Ok(ConvertOutcome::SkippedValid {
                    tape_bytes: existing,
                })
            }
            Err(Fallback::Invalid(TapeError::Version(v))) if v > codec::FORMAT_VERSION => {
                return Ok(ConvertOutcome::NewerFormat(v))
            }
            Err(_) => {}
        }
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
    after_read();
    if let Some(e) = expected {
        if e.bytes != identity.bytes || e.sha256 != identity.sha256 {
            return Ok(ConvertOutcome::SourceChanged {
                bytes: identity.bytes,
                sha256: identity.sha256,
            });
        }
    }
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
