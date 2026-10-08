//! Column-wise Parquet reading helpers (no row API, no per-row allocation).
//!
//! A row group is read one column at a time with `read_records`; each column
//! keeps its values plus per-row value ranges, so optional, required and
//! repeated (top-level `repeated <primitive>`) columns are accessed uniformly.

use anyhow::{bail, ensure, Context, Result};
use parquet::data_type::DataType;
use parquet::file::metadata::RowGroupMetaData;
use parquet::file::reader::{FileReader, RowGroupReader, SerializedFileReader};
use parquet::file::statistics::Statistics;
use std::fs::File;
use std::path::Path;

pub(crate) fn open(path: &Path) -> Result<SerializedFileReader<File>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    SerializedFileReader::new(file).with_context(|| format!("read parquet footer of {}", path.display()))
}

/// Leaf column index by (top-level) name.
pub(crate) fn column_index(reader: &SerializedFileReader<File>, name: &str) -> Option<usize> {
    reader
        .metadata()
        .file_metadata()
        .schema_descr()
        .columns()
        .iter()
        .position(|c| c.path().string() == name)
}

pub(crate) fn require_column(reader: &SerializedFileReader<File>, path: &Path, name: &str) -> Result<usize> {
    column_index(reader, name)
        .with_context(|| format!("{}: missing parquet column `{name}`", path.display()))
}

/// One decoded column of one row group.
pub(crate) struct Column<T> {
    pub values: Vec<T>,
    def: Vec<i16>,
    rep: Vec<i16>,
    /// `values[starts[r]..starts[r + 1]]` belong to row `r`.
    starts: Vec<u32>,
}

impl<T: Clone + Default> Column<T> {
    pub fn new() -> Self {
        Self {
            values: Vec::new(),
            def: Vec::new(),
            rep: Vec::new(),
            starts: Vec::new(),
        }
    }

    /// Values of row `r` (empty for null / empty list).
    #[inline]
    pub fn row(&self, r: usize) -> &[T] {
        &self.values[self.starts[r] as usize..self.starts[r + 1] as usize]
    }

    /// First value of row `r` (`None` for null).
    #[inline]
    pub fn get(&self, r: usize) -> Option<&T> {
        self.row(r).first()
    }

    /// Reads all `rows` records of column `col` from a row group.
    pub fn read<D>(&mut self, rg: &dyn RowGroupReader, col: usize, rows: usize) -> Result<()>
    where
        D: DataType<T = T>,
    {
        let descr = rg.metadata().column(col).column_descr_ptr();
        let name = descr.path().string();
        ensure!(
            descr.physical_type() == D::get_physical_type(),
            "parquet column `{name}`: physical type {} (expected {})",
            descr.physical_type(),
            D::get_physical_type()
        );
        let (max_def, max_rep) = (descr.max_def_level(), descr.max_rep_level());
        ensure!(max_rep <= 1, "parquet column `{name}`: nested lists are not supported");
        self.values.clear();
        self.def.clear();
        self.rep.clear();
        self.starts.clear();
        let Some(mut reader) = D::get_column_reader(rg.get_column_reader(col)?) else {
            bail!("parquet column `{name}`: typed reader mismatch");
        };
        let mut records = 0;
        while records < rows {
            let (n, _, _) = reader.read_records(
                rows - records,
                (max_def > 0).then_some(&mut self.def),
                (max_rep > 0).then_some(&mut self.rep),
                &mut self.values,
            )?;
            ensure!(n > 0, "parquet column `{name}`: ended after {records} of {rows} rows");
            records += n;
        }
        if max_def == 0 && max_rep == 0 {
            self.starts.extend(0..=rows as u32);
        } else {
            let levels = if max_rep > 0 { self.rep.len() } else { self.def.len() };
            let mut count = 0u32;
            for i in 0..levels {
                if max_rep == 0 || self.rep[i] == 0 {
                    self.starts.push(count);
                }
                if max_def == 0 || self.def[i] == max_def {
                    count += 1;
                }
            }
            self.starts.push(count);
        }
        ensure!(
            self.starts.len() == rows + 1 && *self.starts.last().unwrap_or(&0) as usize == self.values.len(),
            "parquet column `{name}`: level/value mismatch"
        );
        Ok(())
    }
}

/// A row group of one of several files.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) struct GroupRef {
    pub file: usize,
    pub group: usize,
}

/// Row groups needed for an as-of series: every group that may hold rows
/// with `from <= time <= to`, plus the groups that may hold the seed (the
/// row with the highest order key among `time < from`).
pub(crate) struct GroupPlan {
    pub range: Vec<GroupRef>,
    /// Seed-only candidates, highest possible order key first (unknown first).
    /// Stop reading once the best seed's key is >= the next group's maximum.
    pub seed_only: Vec<(GroupRef, Option<i64>)>,
}

pub(crate) fn plan_groups(
    files: &[SerializedFileReader<File>],
    time_col: &[usize],
    order_col: &[usize],
    from: i64,
    to: i64,
) -> GroupPlan {
    let mut plan = GroupPlan {
        range: Vec::new(),
        seed_only: Vec::new(),
    };
    for (file, reader) in files.iter().enumerate() {
        for group in 0..reader.num_row_groups() {
            let meta = reader.metadata().row_group(group);
            let at = GroupRef { file, group };
            match int_bounds(meta, time_col[file]) {
                Some((lo, hi)) if hi < from || lo > to => {
                    if lo < from {
                        let order_max = int_bounds(meta, order_col[file]).map(|(_, hi)| hi);
                        plan.seed_only.push((at, order_max));
                    }
                }
                _ => plan.range.push(at),
            }
        }
    }
    plan.seed_only
        .sort_by_key(|(_, max)| std::cmp::Reverse(max.unwrap_or(i64::MAX)));
    plan
}

/// Integer min/max statistics of a column chunk (`None` when absent).
pub(crate) fn int_bounds(rg: &RowGroupMetaData, col: usize) -> Option<(i64, i64)> {
    match rg.column(col).statistics()? {
        Statistics::Int64(s) => Some((*s.min_opt()?, *s.max_opt()?)),
        Statistics::Int32(s) => Some((i64::from(*s.min_opt()?), i64::from(*s.max_opt()?))),
        _ => None,
    }
}
