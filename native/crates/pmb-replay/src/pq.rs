//! Column-wise Parquet reading helpers (no row API, no per-row allocation).
//!
//! A row group is read one column at a time with `read_records`; each column
//! keeps its values plus per-row value ranges, so optional, required and
//! repeated (top-level `repeated <primitive>`) columns are accessed uniformly.

use anyhow::{bail, ensure, Context, Result};
use parquet::data_type::DataType;
use parquet::file::reader::{RowGroupReader, SerializedFileReader};
use std::fs::File;
use std::path::Path;

pub(crate) fn open(path: &Path) -> Result<SerializedFileReader<File>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    SerializedFileReader::new(file)
        .with_context(|| format!("read parquet footer of {}", path.display()))
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
        ensure!(
            max_rep <= 1,
            "parquet column `{name}`: nested lists are not supported"
        );
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
            ensure!(
                n > 0,
                "parquet column `{name}`: ended after {records} of {rows} rows"
            );
            records += n;
        }
        if max_def == 0 && max_rep == 0 {
            self.starts.extend(0..=rows as u32);
        } else {
            let levels = if max_rep > 0 {
                self.rep.len()
            } else {
                self.def.len()
            };
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
            self.starts.len() == rows + 1
                && *self.starts.last().unwrap_or(&0) as usize == self.values.len(),
            "parquet column `{name}`: level/value mismatch"
        );
        Ok(())
    }
}
