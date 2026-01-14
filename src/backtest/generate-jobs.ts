import * as fs from "node:fs";
import * as path from "node:path";

type GridJSON = {
  before: string;
  after: string;
  params: Record<string, unknown>;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function escapeShellArg(value: string): string {
  // Keep simple tokens unquoted; quote anything else safely
  if (/^[a-zA-Z0-9._=:/+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function fmtRangeNum(n: number): string {
  // Your ranges are like 0.20; keep 2 decimals
  return n.toFixed(2);
}

function nextAvailableFilename(dir: string, baseName: string): string {
  // baseName like "v1-jobs.txt"
  const full = (name: string) => path.join(dir, name);

  if (!fs.existsSync(full(baseName))) return full(baseName);

  const ext = path.extname(baseName); // ".txt"
  const stem = baseName.slice(0, -ext.length); // "v1-jobs"

  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!fs.existsSync(full(candidate))) return full(candidate);
  }
  die(`Could not find available filename for ${baseName} in ${dir}`);
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, curr) => {
      const out: T[][] = [];
      for (const a of acc) for (const c of curr) out.push([...a, c]);
      return out;
    },
    [[]],
  );
}

function normalizeParamValues(key: string, raw: unknown): unknown[] {
  if (!Array.isArray(raw)) {
    die(`params.${key} must be an array`);
  }
  return raw;
}

function buildJobs(grid: GridJSON): string[] {
  const { before, after, params } = grid;

  if (!isString(before) || !before.trim()) die(`"before" must be a non-empty string`);
  if (!isString(after)) die(`"after" must be a string`);

  // Pull out dwallRanges (special handling)
  const dwallRangesRaw = params["dwallRanges"];
  const hasRanges = typeof dwallRangesRaw !== "undefined";

  // Build list of param keys excluding dwallRanges (handled separately)
  const keys = Object.keys(params).filter((k) => k !== "dwallRanges");

  // Build arrays for cartesian product
  const valueArrays = keys.map((k) => normalizeParamValues(k, params[k]));

  // Expand all non-range params combinations
  const combos = cartesianProduct(valueArrays);

  // Prepare ranges
  const ranges: Array<[number, number]> = [];
  if (hasRanges) {
    const rr = normalizeParamValues("dwallRanges", dwallRangesRaw);
    for (const item of rr) {
      if (!Array.isArray(item) || item.length !== 2 || !isNumber(item[0]) || !isNumber(item[1])) {
        die(`params.dwallRanges must contain [number, number] pairs`);
      }
      ranges.push([item[0], item[1]]);
    }
    if (ranges.length === 0) die(`params.dwallRanges is empty`);
  } else {
    // No ranges => just one "null" range option (no dwellRangeFrom/To emitted)
    ranges.push([NaN, NaN]);
  }

  const jobs: string[] = [];

  for (const combo of combos) {
    const kv: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) kv[keys[i]] = combo[i];

    const allow = kv["timeFilterAllowTradingAfterSeconds"];
    const disable = kv["timeFilterDisableTradingAfterSeconds"];

    // Constraint B (only if both exist and are numbers)
    if (typeof allow !== "undefined" && typeof disable !== "undefined") {
      if (!isNumber(allow) || !isNumber(disable)) {
        die(`timeFilterAllowTradingAfterSeconds and timeFilterDisableTradingAfterSeconds must be numbers`);
      }
      if (allow + 60 > disable) continue;
    }

    for (const [from, to] of ranges) {
      const parts: string[] = [];
      parts.push(before.trim());

      // Emit --param for each key/value
      for (const [k, v] of Object.entries(kv)) {
        if (typeof v === "undefined") continue;

        // Allow numbers/strings/bools; everything else stringify
        let valStr: string;
        if (isNumber(v)) valStr = String(v);
        else if (isString(v)) valStr = v;
        else if (typeof v === "boolean") valStr = v ? "true" : "false";
        else valStr = JSON.stringify(v);

        parts.push(`--param ${escapeShellArg(`${k}=${valStr}`)}`);
      }

      // Range expansion -> dwellRangeFrom / dwellRangeTo
      if (hasRanges) {
        parts.push(`--param ${escapeShellArg(`dwellRangeFrom=${fmtRangeNum(from)}`)}`);
        parts.push(`--param ${escapeShellArg(`dwellRangeTo=${fmtRangeNum(to)}`)}`);
      }

      if (after.trim()) parts.push(after.trim());

      jobs.push(parts.join(" "));
    }
  }

  return jobs;
}

function inferBaseNameFromGridFile(gridPath: string): string {
  // v1-grid.json -> v1-jobs.txt
  const base = path.basename(gridPath);
  const m = base.match(/^(.*)-grid\.json$/);
  const prefix = m ? m[1] : base.replace(/\.json$/i, "");
  return `${prefix}-jobs.txt`;
}

// ---- main ----
const gridPath = process.argv[2];
if (!gridPath) {
  die(`Usage: node generate-jobs.js <path-to-grid.json>\nExample: node generate-jobs.js ./strategies/split/v1-grid.json`);
}

const absGridPath = path.resolve(process.cwd(), gridPath);
if (!fs.existsSync(absGridPath)) die(`Grid file not found: ${absGridPath}`);

const dir = path.dirname(absGridPath);

let parsed: GridJSON;
try {
  parsed = JSON.parse(fs.readFileSync(absGridPath, "utf8"));
} catch (e) {
  die(`Failed to parse JSON: ${absGridPath}`);
}

if (!parsed || typeof parsed !== "object") die(`Invalid JSON structure in ${absGridPath}`);

const jobs = buildJobs(parsed);

const baseName = inferBaseNameFromGridFile(absGridPath);
const outPath = nextAvailableFilename(dir, baseName);

fs.writeFileSync(outPath, jobs.join("\n") + "\n", "utf8");
console.log(`Wrote ${jobs.length} jobs to ${outPath}`);

console.log("Grid file:", absGridPath);
console.log("Jobs written to:", outPath);
console.log("Total jobs:", jobs.length);