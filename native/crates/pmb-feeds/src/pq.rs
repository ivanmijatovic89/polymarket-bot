//! Column-wise Parquet helpers for feed day files (salvaged from the WIP
//! `native/crates/pmb-replay/src/pq.rs`, 14 §15): no row API, no per-row
//! allocation. Errors are plain strings; the caller classifies them as
//! `runtime: decode_unverified` (14 §4.1).

use parquet::basic::Type as PhysicalType;
use parquet::data_type::DataType;
use parquet::file::reader::{FileReader, RowGroupReader, SerializedFileReader};
use std::fs::File;
use std::path::Path;

pub(crate) type PqResult<T> = Result<T, String>;

pub(crate) fn open(path: &Path) -> PqResult<SerializedFileReader<File>> {
    let file = File::open(path).map_err(|e| format!("open: {e}"))?;
    SerializedFileReader::new(file).map_err(|e| format!("parquet footer: {e}"))
}

/// Index of the top-level column `name` with physical type `ty`.
pub(crate) fn column(
    reader: &SerializedFileReader<File>,
    name: &str,
    ty: PhysicalType,
) -> PqResult<usize> {
    let schema = reader.metadata().file_metadata().schema_descr();
    for i in 0..schema.num_columns() {
        let c = schema.column(i);
        if c.path().string() == name {
            if c.physical_type() != ty {
                return Err(format!(
                    "column `{name}` has physical type {} (expected {ty})",
                    c.physical_type()
                ));
            }
            return Ok(i);
        }
    }
    Err(format!("column `{name}` is missing"))
}

/// One decoded column of one row group.
pub(crate) struct Column<T> {
    pub values: Vec<T>,
    def: Vec<i16>,
    /// `values[starts[r]..starts[r + 1]]` belong to row `r`.
    starts: Vec<u32>,
}

impl<T: Clone + Default> Column<T> {
    pub fn new() -> Self {
        Self {
            values: Vec::new(),
            def: Vec::new(),
            starts: Vec::new(),
        }
    }

    /// First value of row `r` (`None` for null).
    #[inline]
    pub fn get(&self, r: usize) -> Option<&T> {
        let (a, b) = (self.starts[r] as usize, self.starts[r + 1] as usize);
        (a < b).then(|| &self.values[a])
    }

    /// Reads all `rows` records of flat column `col` from a row group.
    pub fn read<D>(&mut self, rg: &dyn RowGroupReader, col: usize, rows: usize) -> PqResult<()>
    where
        D: DataType<T = T>,
    {
        let descr = rg.metadata().column(col).column_descr_ptr();
        let name = descr.path().string();
        if descr.max_rep_level() > 0 {
            return Err(format!("column `{name}` is repeated"));
        }
        let max_def = descr.max_def_level();
        self.values.clear();
        self.def.clear();
        self.starts.clear();
        let reader = rg
            .get_column_reader(col)
            .map_err(|e| format!("column `{name}`: {e}"))?;
        let Some(mut reader) = D::get_column_reader(reader) else {
            return Err(format!("column `{name}`: typed reader mismatch"));
        };
        let mut records = 0;
        while records < rows {
            let (n, _, _) = reader
                .read_records(
                    rows - records,
                    (max_def > 0).then_some(&mut self.def),
                    None,
                    &mut self.values,
                )
                .map_err(|e| format!("column `{name}`: {e}"))?;
            if n == 0 {
                return Err(format!(
                    "column `{name}` ended after {records} of {rows} rows"
                ));
            }
            records += n;
        }
        if max_def == 0 {
            self.starts.extend(0..=rows as u32);
        } else {
            let mut count = 0u32;
            for &d in &self.def {
                self.starts.push(count);
                if d == max_def {
                    count += 1;
                }
            }
            self.starts.push(count);
        }
        if self.starts.len() != rows + 1 || self.starts[rows] as usize != self.values.len() {
            return Err(format!("column `{name}`: level/value mismatch"));
        }
        Ok(())
    }
}

/// Rows of row group `g`.
pub(crate) fn group_rows(reader: &SerializedFileReader<File>, g: usize) -> PqResult<usize> {
    usize::try_from(reader.metadata().row_group(g).num_rows())
        .map_err(|_| format!("row group {g}: negative row count"))
}

pub(crate) fn row_group(
    reader: &SerializedFileReader<File>,
    g: usize,
) -> PqResult<Box<dyn RowGroupReader + '_>> {
    reader
        .get_row_group(g)
        .map_err(|e| format!("row group {g}: {e}"))
}
