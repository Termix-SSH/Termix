#!/usr/bin/env node
/**
 * Buttons are never white.
 *
 * Every Button variant is the brand orange with a different background
 * opacity (or red for destructive, or transparent for ghost). Fails when a
 * variant in src/ui/components/button.tsx uses a neutral fill, or when a
 * <Button> anywhere in core or the local plugin checkouts sets a neutral fill
 * in its className.
 */

const fs = require("node:fs");
const path = require("node:path");

const NEUTRAL =
  /(?:^|[\s"'`])(?:dark:)?(?:bg-(?:primary|white|foreground|background|secondary|card|popover|muted|accent|input|neutral-\d+|zinc-\d+|gray-\d+|slate-\d+|stone-\d+)(?![\w-])|text-primary-foreground)/;

/** The opening tag text of each <Button ...> in a source file. */
function buttonTags(source) {
  const tags = [];
  const re = /<Button(?=[\s/>])/g;
  let match;
  while ((match = re.exec(source))) {
    let depth = 0;
    let quote = "";
    let i = match.index + match[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(source.slice(match.index, i + 1));
  }
  return tags;
}

/** Variant strings from the cva block of button.tsx. */
function variantLines(source) {
  const start = source.indexOf("variant: {");
  const end = source.indexOf("size: {");
  if (start < 0 || end < 0) return [];
  return source
    .slice(start, end)
    .split("\n")
    .filter((line) => /["`]/.test(line) && !line.includes("variant: {"));
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "tests", "__fixtures__"].includes(entry.name))
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
}

/** Problems found under the given roots. */
function scan(roots, buttonFile) {
  const problems = [];
  if (buttonFile && fs.existsSync(buttonFile)) {
    for (const line of variantLines(fs.readFileSync(buttonFile, "utf8"))) {
      if (NEUTRAL.test(line)) {
        problems.push(
          `${buttonFile}: neutral fill in a variant: ${line.trim()}`,
        );
      }
    }
  }
  const files = [];
  for (const root of roots) walk(root, files);
  for (const file of files) {
    for (const tag of buttonTags(fs.readFileSync(file, "utf8"))) {
      if (NEUTRAL.test(tag)) {
        problems.push(
          `${file}: <Button> with a neutral fill: ${tag.slice(0, 120)}`,
        );
      }
    }
  }
  return problems;
}

module.exports = { scan, buttonTags, variantLines };

if (require.main === module) {
  const core = path.resolve(__dirname, "..");
  const plugins = path.resolve(core, "..", "Plugins");
  const roots = [path.join(core, "src", "ui")];
  if (fs.existsSync(plugins)) {
    for (const entry of fs.readdirSync(plugins)) {
      roots.push(path.join(plugins, entry, "src"));
    }
  }
  const problems = scan(
    roots,
    path.join(core, "src", "ui", "components", "button.tsx"),
  );
  if (problems.length) {
    console.error("Buttons must be the brand orange, never white or neutral:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("ok  button colors");
}
