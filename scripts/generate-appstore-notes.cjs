const fs = require("fs");
const path = require("path");

// Apple caps the "What's New in This Version" field at 4000 characters.
const MAX_LENGTH = 4000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function fail(message) {
  console.error(`generate-appstore-notes: ${message}`);
  process.exit(1);
}

function extractSection(notes, name, { required = true } = {}) {
  const pattern = new RegExp(
    `<!--\\s*${name}\\s*-->([\\s\\S]*?)<!--\\s*/${name}\\s*-->`,
  );
  const match = notes.match(pattern);
  if (!match) {
    if (required) fail(`missing <!-- ${name} --> section in release notes`);
    return "";
  }
  return match[1].trim();
}

// Strip markdown that reads badly as plain text in App Store Connect.
function toPlainText(markdown) {
  return markdown
    .split("\n")
    .map((line) => {
      let text = line.replace(/\r$/, "");
      const indent = text.match(/^\s*/)[0].length;
      text = text.trim();
      text = text.replace(/^[-*]\s+/, indent >= 2 ? "  - " : "- ");
      text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
      text = text.replace(/`([^`]+)`/g, "$1");
      text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
      text = text.replace(/^#+\s*/, "");
      return text;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Drop whole trailing lines until the text fits, so we never cut a bullet
// in half or leave a dangling section header.
function truncate(text, limit) {
  if (text.length <= limit) return text;

  const lines = text.split("\n");
  while (lines.length > 0 && lines.join("\n").length > limit) {
    lines.pop();
  }
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  // A section header left with no bullets under it is noise.
  while (lines.length > 0 && /^[A-Za-z ]+:$/.test(lines[lines.length - 1])) {
    lines.pop();
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  }
  return lines.join("\n").trim();
}

function buildNotes(notesFile) {
  const summary = extractSection(notesFile, "SUMMARY");
  const updateLog = extractSection(notesFile, "UPDATE_LOG", {
    required: false,
  });
  const bugFixes = extractSection(notesFile, "BUG_FIXES", { required: false });

  const parts = [toPlainText(summary)];
  if (updateLog) parts.push("", "Update Log:", toPlainText(updateLog));
  if (bugFixes) parts.push("", "Bug Fixes:", toPlainText(bugFixes));

  const body = parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) fail("release notes produced no text");
  return truncate(body, MAX_LENGTH);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const notesPath = args.notes || "RELEASE_NOTES.md";
  const outDir = args["out-dir"];
  const locales = String(args.locales || "en-US")
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);

  if (!outDir || outDir === true) fail("--out-dir is required");
  if (locales.length === 0) fail("--locales resolved to no locales");

  const resolvedNotes = path.resolve(notesPath);
  if (!fs.existsSync(resolvedNotes)) {
    fail(`release notes file not found: ${resolvedNotes}`);
  }

  const notes = buildNotes(fs.readFileSync(resolvedNotes, "utf8"));

  for (const locale of locales) {
    const localeDir = path.join(path.resolve(outDir), locale);
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, "release_notes.txt"),
      notes + "\n",
      "utf8",
    );
    console.log(`Wrote ${locale}/release_notes.txt (${notes.length} chars)`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildNotes, toPlainText, truncate, MAX_LENGTH };
