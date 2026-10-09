//! Bench set manifests (`native/bench/sets/<name>.json`, 16 §13.1).

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Manifest {
    pub bench_set_version: u32,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub input_mode: String,
    pub format: Format,
    pub symbol: String,
    pub timeframe: String,
    pub strategy: String,
    pub params: serde_json::Value,
    pub model_config: ModelConfigRef,
    pub selection: serde_json::Value,
    pub totals: Totals,
    pub markets: Vec<Market>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Format {
    pub name: String,
    pub version: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigRef {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Totals {
    pub markets: u64,
    pub bytes: u64,
    pub rows: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Market {
    pub slug: String,
    /// Path relative to the repository root, under `data/`.
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
    pub rows: u64,
    pub tokens: Tokens,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tokens {
    pub up: String,
    pub down: String,
}

impl Manifest {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        use anyhow::{ensure, Context};
        let text =
            std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        let m: Manifest = serde_json::from_str(&text)
            .with_context(|| format!("parse bench set {}", path.display()))?;
        ensure!(
            m.bench_set_version == 1,
            "bench set version {}",
            m.bench_set_version
        );
        ensure!(
            m.input_mode == "telonex-delta"
                && m.format.name == pmb_replay::telonex::FORMAT_NAME
                && m.format.version == pmb_replay::telonex::FORMAT_VERSION,
            "{}: only telonex-delta-typed v1 sets are supported (NT-9)",
            path.display()
        );
        ensure!(
            m.totals.markets == m.markets.len() as u64,
            "{}: totals.markets != number of markets",
            path.display()
        );
        Ok(m)
    }
}

impl Market {
    /// Absolute v1 path: `file` is `data/<rest>` and resolves to `<data_root>/<rest>`.
    pub fn v1_path(&self, data_root: &Path) -> anyhow::Result<PathBuf> {
        let rest = self.file.strip_prefix("data/").ok_or_else(|| {
            anyhow::anyhow!("{}: file {} is not under data/", self.slug, self.file)
        })?;
        anyhow::ensure!(
            !rest
                .split('/')
                .any(|c| c.is_empty() || c == "." || c == ".."),
            "{}: file {} is not a plain relative path",
            self.slug,
            self.file
        );
        Ok(data_root.join(rest))
    }

    pub fn sha256_bytes(&self) -> anyhow::Result<[u8; 32]> {
        crate::store::parse_hex32(&self.sha256)
            .ok_or_else(|| anyhow::anyhow!("{}: bad sha256 {}", self.slug, self.sha256))
    }
}
