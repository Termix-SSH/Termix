#!/usr/bin/env node
// Line coverage across the unit tests and the authorization matrix.
//
//   node scripts/coverage-merged.mjs <vitest coverage-final.json> <c8 coverage-final.json> [--min 80]
//
// Both inputs are istanbul JSON. Vitest counts statements and c8 counts
// lines, so the two are joined per line: a line is covered when either run
// executed it. Prints a Markdown summary and fails under --min.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Repo relative path, the same on Windows and Linux runners. */
export function repoPath(file) {
  const clean = file.replace(/\\/g, "/");
  const at = clean.search(/\/(src|packages)\//);
  return at < 0 ? clean : clean.slice(at + 1);
}

/** file -> line -> hits, test code left out. */
export function lineHits(json) {
  const out = new Map();
  for (const [file, data] of Object.entries(json)) {
    const path = repoPath(file);
    if (/\/tests\/|\.test\.[cm]?[jt]sx?$/.test(path)) continue;
    const lines = out.get(path) ?? new Map();
    for (const [id, loc] of Object.entries(data.statementMap ?? {})) {
      const line = loc.start.line;
      lines.set(line, (lines.get(line) ?? 0) + (data.s?.[id] ?? 0));
    }
    out.set(path, lines);
  }
  return out;
}

/** Counts over the unit run's files; the matrix only adds hits. */
export function merge(unit, authz) {
  let total = 0;
  let unitCovered = 0;
  let covered = 0;
  for (const [path, lines] of unit) {
    const other = authz.get(path);
    for (const [line, hits] of lines) {
      total++;
      if (hits > 0) unitCovered++;
      if (hits > 0 || (other?.get(line) ?? 0) > 0) covered++;
    }
  }
  return { total, unitCovered, covered };
}

function main() {
  const args = process.argv.slice(2);
  const files = args.filter(
    (arg, i) => !arg.startsWith("--") && args[i - 1] !== "--min",
  );
  const minIndex = args.indexOf("--min");
  const min = minIndex === -1 ? 0 : Number(args[minIndex + 1]);

  if (files.length !== 2) {
    console.error(
      "usage: coverage-merged.mjs <unit.json> <authz.json> [--min 80]",
    );
    process.exit(2);
  }

  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const { total, unitCovered, covered } = merge(
    lineHits(read(files[0])),
    lineHits(read(files[1])),
  );
  const pct = (n) => (total ? (100 * n) / total : 0).toFixed(2);

  console.log("| Run | Lines covered |");
  console.log("| --- | --- |");
  console.log(
    `| Unit tests | ${pct(unitCovered)}% (${unitCovered}/${total}) |`,
  );
  console.log(
    `| Unit tests and authorization matrix | ${pct(covered)}% (${covered}/${total}) |`,
  );

  if (min && (100 * covered) / total < min) {
    console.error(`Coverage ${pct(covered)}% is under ${min}%`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
