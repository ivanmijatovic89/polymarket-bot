//! L0 micro benchmarks of the fixed-point scalars (16 §13.2 L0, 10 §2–§3).
//!
//! Each bench walks a deterministic input table (no RNG crate, R7) so the
//! optimizer cannot fold the arithmetic, and reports time per operation.
//! Run: `cargo bench -p domain --bench fixed`. Numbers are read only as
//! before/after A/B on the same host (01 §6 M1 step 7).

use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use domain::fixed::{format_micros, mul_div, parse_decimal};
use domain::{Price, Qty, Rate, Rounding, Usdc};
use std::hint::black_box;

const N: usize = 4096;

/// SplitMix64: a fixed, seedless sequence for input tables.
fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

struct Inputs {
    prices: Vec<Price>,
    qtys: Vec<Qty>,
    usdc: Vec<Usdc>,
    rates: Vec<Rate>,
    decimals: Vec<String>,
}

fn inputs() -> Inputs {
    let mut s = 0x5eed_u64;
    let mut prices = Vec::with_capacity(N);
    let mut qtys = Vec::with_capacity(N);
    let mut usdc = Vec::with_capacity(N);
    let mut rates = Vec::with_capacity(N);
    let mut decimals = Vec::with_capacity(N);
    for i in 0..N {
        // Prices in (0, 1) on mixed grids, some off-grid (sub-tick) values.
        let p = 1 + (splitmix(&mut s) % 999_999) as i64;
        prices.push(Price::from_micros(p));
        // Sizes from dust to 100k shares.
        let q = 1 + (splitmix(&mut s) % 100_000_000_000) as i64;
        qtys.push(Qty::from_micros(q));
        usdc.push(Usdc::from_micros(
            1 + (splitmix(&mut s) % 10_000_000_000) as i64,
        ));
        rates.push(Rate::from_micros((splitmix(&mut s) % 100_000) as i64));
        // The decimal shapes seen in telonex-delta columns: tick prices,
        // sizes with 2–6 fractional digits, whole sizes, rare long fractions.
        let d = match i % 8 {
            0..=2 => format!("0.{:02}", 1 + splitmix(&mut s) % 99),
            3 => format!("0.{:03}", 1 + splitmix(&mut s) % 999),
            4 | 5 => format!(
                "{}.{:02}",
                splitmix(&mut s) % 100_000,
                splitmix(&mut s) % 100
            ),
            6 => format!("{}", splitmix(&mut s) % 1_000_000),
            _ => format!(
                "{}.{:09}",
                splitmix(&mut s) % 1000,
                splitmix(&mut s) % 1_000_000_000
            ),
        };
        decimals.push(d);
    }
    Inputs {
        prices,
        qtys,
        usdc,
        rates,
        decimals,
    }
}

fn bench_fixed(c: &mut Criterion) {
    let x = inputs();
    let mut g = c.benchmark_group("fixed");
    g.throughput(Throughput::Elements(N as u64));

    for (name, mode) in [
        ("floor", Rounding::Floor),
        ("ceil", Rounding::Ceil),
        ("toward_zero", Rounding::TowardZero),
        ("half_away", Rounding::HalfAwayFromZero),
    ] {
        g.bench_function(format!("mul_div/{name}"), |b| {
            b.iter(|| {
                let mut acc = 0i64;
                for i in 0..N {
                    let v = mul_div(
                        x.prices[i].micros(),
                        x.qtys[i].micros(),
                        1_000_000,
                        black_box(mode),
                    );
                    acc = acc.wrapping_add(v.unwrap_or(0));
                }
                black_box(acc)
            })
        });
    }

    g.bench_function("price_notional", |b| {
        b.iter(|| {
            let mut acc = 0i64;
            for i in 0..N {
                let v = black_box(x.prices[i]).notional(x.qtys[i], Rounding::Ceil);
                acc = acc.wrapping_add(v.map(Usdc::micros).unwrap_or(0));
            }
            black_box(acc)
        })
    });

    g.bench_function("qty_for_collateral", |b| {
        b.iter(|| {
            let mut acc = 0i64;
            for i in 0..N {
                let v = Qty::for_collateral(black_box(x.usdc[i]), x.prices[i], Rounding::Floor);
                acc = acc.wrapping_add(v.map(Qty::micros).unwrap_or(0));
            }
            black_box(acc)
        })
    });

    g.bench_function("usdc_mul_rate", |b| {
        b.iter(|| {
            let mut acc = 0i64;
            for i in 0..N {
                let v = black_box(x.usdc[i]).mul_rate(x.rates[i], Rounding::HalfAwayFromZero);
                acc = acc.wrapping_add(v.map(Usdc::micros).unwrap_or(0));
            }
            black_box(acc)
        })
    });

    let tick = Price::from_micros(10_000);
    g.bench_function("price_to_tick", |b| {
        b.iter(|| {
            let mut acc = 0i64;
            for p in &x.prices {
                let v = black_box(*p).to_tick(tick, Rounding::Floor);
                acc = acc.wrapping_add(v.map(Price::micros).unwrap_or(0));
            }
            black_box(acc)
        })
    });

    g.bench_function("price_is_on_tick", |b| {
        b.iter(|| {
            let mut n = 0u32;
            for p in &x.prices {
                n += u32::from(black_box(*p).is_on_tick(tick));
            }
            black_box(n)
        })
    });

    g.bench_function("checked_add_sub", |b| {
        b.iter(|| {
            let mut acc = Usdc::ZERO;
            for u in &x.usdc {
                acc = acc.checked_add(black_box(*u)).unwrap_or(Usdc::ZERO);
                acc = acc
                    .checked_sub(Usdc::from_micros(u.micros() / 2))
                    .unwrap_or(Usdc::ZERO);
            }
            black_box(acc)
        })
    });

    g.bench_function("parse_decimal", |b| {
        b.iter(|| {
            let mut acc = 0i64;
            for d in &x.decimals {
                let v = parse_decimal(black_box(d.as_str()));
                acc = acc.wrapping_add(v.map(|m| m.micros).unwrap_or(0));
            }
            black_box(acc)
        })
    });

    g.bench_function("format_micros", |b| {
        b.iter(|| {
            let mut len = 0usize;
            for u in &x.usdc {
                len += format_micros(black_box(u.micros())).len();
            }
            black_box(len)
        })
    });

    g.finish();
}

criterion_group!(benches, bench_fixed);
criterion_main!(benches);
