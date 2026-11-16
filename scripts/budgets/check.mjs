#!/usr/bin/env node
// Fails when a measured value is over its budget.
//
//   node scripts/budgets/check.mjs <result.json> [budgets.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET_FIELDS, overBudget } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [resultFile, budgetFile = path.join(here, "budgets.json")] =
  process.argv.slice(2);
if (!resultFile) {
  console.error("usage: check.mjs <result.json> [budgets.json]");
  process.exit(2);
}

const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
const budgets = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
const failures = overBudget(result, budgets);

const rows = BUDGET_FIELDS.filter(
  (field) => typeof budgets[field] === "number",
).map((field) => {
  const failed = failures.find((f) => f.field === field);
  return `| ${field} | ${result[field] ?? "missing"} | ${budgets[field]} | ${failed ? "over" : "ok"} |`;
});
const table = [
  "| Measure | Value | Budget | |",
  "| --- | --- | --- | --- |",
  ...rows,
].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Frame and process budgets\n\n${table}\n`,
  );
}
if (failures.length > 0) {
  console.error(
    `Over budget: ${failures.map((f) => `${f.field} ${f.value ?? "missing"} > ${f.limit}`).join(", ")}`,
  );
  process.exit(1);
}
