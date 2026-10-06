//! Historical feed loading from the same daily Parquets as production replay.
use crate::{feeds::Feeds, types::Market};
use anyhow::{bail, ensure, Context, Result};
use parquet::{
    file::{
        reader::{FileReader, SerializedFileReader},
        statistics::Statistics,
    },
    record::{Field, Row},
    schema::types::Type,
};
use serde::Deserialize;
use std::fs::File;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawFeedFiles {
    pub binance: Vec<String>,
    pub chainlink: Vec<String>,
    pub binance_lookback_ms: i64,
    pub chainlink_lookback_ms: i64,
    pub chainlink_max_gap_ms: i64,
}
#[derive(Clone, Copy)]
enum Kind {
    Binance,
    Chainlink,
}
impl Kind {
    fn columns(self) -> [&'static str; 3] {
        match self {
            Self::Binance => ["agg_trade_id", "ts_ms", "price"],
            Self::Chainlink => ["timestamp_us", "server_timestamp_us", "price"],
        }
    }
    fn time_column(self) -> &'static str {
        match self {
            Self::Binance => "ts_ms",
            Self::Chainlink => "timestamp_us",
        }
    }
    fn order_columns(self) -> (&'static str, Option<&'static str>) {
        match self {
            Self::Binance => ("agg_trade_id", None),
            Self::Chainlink => ("server_timestamp_us", Some("timestamp_us")),
        }
    }
}
#[derive(Clone, Copy)]
struct Point {
    time: i64,
    order: (i64, i64),
    price: f64,
}
struct Source {
    reader: SerializedFileReader<File>,
    projection: Type,
}
struct Group {
    source: usize,
    index: usize,
    min_time: Option<i64>,
    max_time: Option<i64>,
    max_order: Option<(i64, i64)>,
}
fn field<'a>(row: &'a Row, name: &str) -> Result<&'a Field> {
    row.get_column_iter()
        .find_map(|(n, v)| (n == name).then_some(v))
        .with_context(|| format!("Missing feed column {name}"))
}
fn integer(row: &Row, name: &str) -> Result<i64> {
    match field(row, name)? {
        Field::Long(v) => Ok(*v),
        Field::Int(v) => Ok(i64::from(*v)),
        v => bail!("Invalid feed integer {name}: {v:?}"),
    }
}
fn identity(row: &Row, kind: Kind) -> Result<Option<(i64, (i64, i64))>> {
    // SQL timestamp predicates exclude NULL timestamps.
    if matches!(field(row, kind.time_column())?, Field::Null) {
        return Ok(None);
    }
    let time = integer(row, kind.time_column())?;
    let (primary, secondary) = kind.order_columns();
    Ok(Some((
        time,
        (
            integer(row, primary)?,
            secondary
                .map(|name| integer(row, name))
                .transpose()?
                .unwrap_or(0),
        ),
    )))
}
fn price(field: &Field) -> Result<f64> {
    let value = crate::number(field)?;
    ensure!(value.is_finite(), "Nonfinite feed price");
    Ok(value)
}
fn bounds(reader: &SerializedFileReader<File>, group: usize, name: &str) -> Option<(i64, i64)> {
    let meta = reader.metadata().row_group(group);
    let column = meta
        .columns()
        .iter()
        .find(|c| c.column_path().string() == name)?;
    match column.statistics()? {
        Statistics::Int64(v) => Some((*v.min_opt()?, *v.max_opt()?)),
        Statistics::Int32(v) => Some((i64::from(*v.min_opt()?), i64::from(*v.max_opt()?))),
        _ => None,
    }
}
fn series(paths: &[String], from: i64, to: i64, kind: Kind) -> Result<Vec<Point>> {
    ensure!(!paths.is_empty(), "Missing original feed paths");
    let mut sources = Vec::new();
    let mut groups = Vec::new();
    for path in paths {
        let reader = SerializedFileReader::new(
            File::open(path).with_context(|| format!("Missing feed day file {path}"))?,
        )?;
        let schema = reader
            .metadata()
            .file_metadata()
            .schema_descr()
            .root_schema();
        let names = kind.columns();
        let fields = schema
            .get_fields()
            .iter()
            .filter(|f| names.contains(&f.name()))
            .cloned()
            .collect::<Vec<_>>();
        ensure!(
            fields.len() == names.len() && fields.iter().all(|f| f.is_primitive()),
            "Unsupported feed schema in {path}"
        );
        let projection = Type::group_type_builder(schema.name())
            .with_fields(fields)
            .build()?;
        for index in 0..reader.num_row_groups() {
            let times = bounds(&reader, index, kind.time_column());
            let (primary, secondary) = kind.order_columns();
            let max_order = bounds(&reader, index, primary).and_then(|p| {
                secondary.map_or(Some((p.1, 0)), |s| {
                    bounds(&reader, index, s).map(|v| (p.1, v.1))
                })
            });
            groups.push(Group {
                source: sources.len(),
                index,
                min_time: times.map(|v| v.0),
                max_time: times.map(|v| v.1),
                max_order,
            });
        }
        sources.push(Source { reader, projection });
    }
    // A group maximum is a safe upper bound for seed ORDER BY. Unknown
    // statistics are decoded conservatively; no timestamp-order assumption.
    groups.sort_by_key(|g| std::cmp::Reverse(g.max_order.unwrap_or((i64::MAX, i64::MAX))));
    let mut seed: Option<(i64, (i64, i64), Field)> = None;
    let mut selected = Vec::new();
    for group in groups {
        let overlaps =
            group.max_time.is_none_or(|v| v >= from) && group.min_time.is_none_or(|v| v <= to);
        let seed_possible = group.min_time.is_none_or(|v| v < from)
            && match (&seed, group.max_order) {
                (Some(s), Some(upper)) => upper >= s.1,
                _ => true,
            };
        if !overlaps && !seed_possible {
            continue;
        }
        let source = &sources[group.source];
        let reader = source.reader.get_row_group(group.index)?;
        for row in reader.get_row_iter(Some(source.projection.clone()))? {
            let row = row?;
            let Some((time, order)) = identity(&row, kind)? else {
                continue;
            };
            if time < from {
                if seed.as_ref().is_none_or(|s| order > s.1) {
                    // Only the final seed is cast, as with SQL ORDER BY/LIMIT.
                    seed = Some((time, order, field(&row, "price")?.clone()));
                }
            } else if time <= to {
                selected.push(Point {
                    time,
                    order,
                    price: price(field(&row, "price")?)?,
                });
            }
        }
    }
    selected.sort_by_key(|p| p.order);
    if let Some((time, order, value)) = seed {
        selected.insert(
            0,
            Point {
                time,
                order,
                price: price(&value)?,
            },
        );
    }
    ensure!(
        !selected.is_empty(),
        "Original feed files contain no rows up to window end"
    );
    Ok(selected)
}
fn check_gap(rounds: &[i64], start: i64, end: i64, max_gap: i64) -> Result<()> {
    ensure!(max_gap >= 0, "Invalid Chainlink gap threshold");
    if max_gap == 0 {
        return Ok(());
    }
    let mut sorted = rounds.to_vec();
    sorted.sort();
    let mut prev = i64::MIN;
    let mut worst = 0;
    for next in sorted.into_iter().chain(std::iter::once(i64::MAX)) {
        worst = worst.max(next.min(end).saturating_sub(prev.max(start)));
        prev = next;
        if next >= end {
            break;
        }
    }
    ensure!(
        worst < max_gap,
        "MISSING chainlink data: stale span {worst} ms in [{start}, {end}]"
    );
    Ok(())
}
pub fn load(files: &RawFeedFiles, market: &Market) -> Result<Feeds> {
    ensure!(
        market.start_ms >= 1775088000000,
        "Market predates Chainlink coverage"
    );
    ensure!(
        files.binance_lookback_ms >= 0 && files.chainlink_lookback_ms >= 0,
        "Invalid feed lookback"
    );
    let binance = series(
        &files.binance,
        market.start_ms - files.binance_lookback_ms,
        market.end_ms + 2000,
        Kind::Binance,
    )?
    .into_iter()
    .map(|p| [p.time as f64, p.price])
    .collect();
    let chainlink: Vec<[f64; 3]> = series(
        &files.chainlink,
        (market.start_ms - files.chainlink_lookback_ms) * 1000,
        (market.end_ms + 5000) * 1000,
        Kind::Chainlink,
    )?
    .into_iter()
    .map(|p| {
        [
            p.time.div_euclid(1000) as f64,
            p.order.0.div_euclid(1000) as f64,
            p.price,
        ]
    })
    .collect();
    ensure!(
        chainlink.iter().all(|p| p[1].is_finite() && p[1] > 0.0),
        "Invalid Chainlink broadcast timestamp"
    );
    check_gap(
        &chainlink.iter().map(|p| p[0] as i64).collect::<Vec<_>>(),
        market.start_ms,
        market.end_ms,
        files.chainlink_max_gap_ms,
    )?;
    Ok(Feeds { binance, chainlink })
}

#[cfg(test)]
mod tests {
    use super::*;
    use parquet::{
        data_type::{ByteArray, ByteArrayType, Int64Type},
        file::writer::SerializedFileWriter,
        schema::parser::parse_message_type,
    };
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn fixture(kind: Kind, groups: &[Vec<(i64, i64, &str)>]) -> Fixture {
        let path = std::env::temp_dir().join(format!(
            "rust-feed-test-{}-{}.parquet",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let names = kind.columns();
        let schema = Arc::new(parse_message_type(&format!("message feed {{ REQUIRED INT64 {}; REQUIRED INT64 {}; REQUIRED BINARY price (UTF8); }}", names[0], names[1])).unwrap());
        let mut writer =
            SerializedFileWriter::new(File::create(&path).unwrap(), schema, Default::default())
                .unwrap();
        for rows in groups {
            let mut group = writer.next_row_group().unwrap();
            for index in 0..3 {
                let mut column = group.next_column().unwrap().unwrap();
                if index < 2 {
                    let values: Vec<_> = rows
                        .iter()
                        .map(|r| if index == 0 { r.0 } else { r.1 })
                        .collect();
                    column
                        .typed::<Int64Type>()
                        .write_batch(&values, None, None)
                        .unwrap();
                } else {
                    let values: Vec<_> = rows.iter().map(|r| ByteArray::from(r.2)).collect();
                    column
                        .typed::<ByteArrayType>()
                        .write_batch(&values, None, None)
                        .unwrap();
                }
                column.close().unwrap();
            }
            group.close().unwrap();
        }
        writer.close().unwrap();
        Fixture(path)
    }
    #[test]
    fn binance_seed_uses_id_and_preserves_same_timestamp_order() {
        let file = fixture(
            Kind::Binance,
            &[
                vec![(50, 900, "10"), (60, 950, "11")],
                vec![
                    (10, 920, "12"),
                    (70, 1000, "13"),
                    (80, 1000, "14"),
                    (90, 2001, "15"),
                ],
            ],
        );
        let points = series(
            &[file.0.to_string_lossy().into_owned()],
            1000,
            2000,
            Kind::Binance,
        )
        .unwrap();
        assert_eq!(
            points
                .iter()
                .map(|p| (p.order.0, p.time, p.price))
                .collect::<Vec<_>>(),
            vec![(60, 950, 11.0), (70, 1000, 13.0), (80, 1000, 14.0)]
        );
    }
    #[test]
    fn chainlink_filters_round_clock_but_sorts_broadcast_before_truncation() {
        let file = fixture(
            Kind::Chainlink,
            &[vec![
                (990000, 1500000, "10"),
                (980000, 1600000, "11"),
                (1000999, 2000100, "12"),
                (1000000, 2000900, "13"),
                (2000001, 3000000, "14"),
            ]],
        );
        let points = series(
            &[file.0.to_string_lossy().into_owned()],
            1000000,
            2000000,
            Kind::Chainlink,
        )
        .unwrap();
        assert_eq!(
            points
                .iter()
                .map(|p| (p.time, p.order.0, p.price))
                .collect::<Vec<_>>(),
            vec![
                (980000, 1600000, 11.0),
                (1000999, 2000100, 12.0),
                (1000000, 2000900, 13.0)
            ]
        );
    }
    #[test]
    fn gap_rejection_includes_missing_start_and_end_seed_boundaries() {
        assert!(check_gap(&[100, 200], 0, 500, 300).is_err());
        assert!(check_gap(&[100, 200, 490], 0, 500, 300).is_ok());
        assert!(check_gap(&[], 0, 500, 300).is_err());
        assert!(check_gap(&[], 0, 500, 0).is_ok());
    }
    #[test]
    fn seed_candidates_across_files_do_not_assume_timestamp_order() {
        let a = fixture(Kind::Binance, &[vec![(90, 900, "10")]]);
        let b = fixture(Kind::Binance, &[vec![(80, 990, "11"), (100, 1100, "12")]]);
        let points = series(
            &[
                a.0.to_string_lossy().into_owned(),
                b.0.to_string_lossy().into_owned(),
            ],
            1000,
            1200,
            Kind::Binance,
        )
        .unwrap();
        assert_eq!(
            points.iter().map(|p| p.order.0).collect::<Vec<_>>(),
            vec![90, 100]
        );
    }
    #[test]
    fn irrelevant_rows_are_not_cast_and_missing_files_fail() {
        let file = fixture(
            Kind::Chainlink,
            &[vec![
                (100, 100, "invalid"),
                (900, 900, "10"),
                (1000, 1000, "11"),
                (2001, 2001, "invalid"),
            ]],
        );
        let points = series(
            &[file.0.to_string_lossy().into_owned()],
            1000,
            2000,
            Kind::Chainlink,
        )
        .unwrap();
        assert_eq!(
            points.iter().map(|p| p.price).collect::<Vec<_>>(),
            vec![10.0, 11.0]
        );
        assert!(series(&[], 1000, 2000, Kind::Chainlink).is_err());
        assert!(series(
            &["/definitely-missing-feed.parquet".into()],
            1000,
            2000,
            Kind::Chainlink
        )
        .is_err());
    }
}
