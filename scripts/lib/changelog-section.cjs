/**
 * The Markdown under one version's "## x.y.z" heading in CHANGELOG.md.
 * The release scripts run before the SDK is built, so this is a small copy
 * of changelogSection from packages/plugin-sdk/src/changelog.ts; lint checks
 * the whole file with the real parser.
 */
function changelogSection(markdown, version) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const heading =
    /^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s+-\s+.+?)?\s*$/;
  let start = -1;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) fence = !fence;
    if (fence || !/^##\s/.test(line)) continue;
    if (start >= 0) return lines.slice(start, i).join("\n").trim();
    const match = heading.exec(line.trim());
    if (match && match[1] === version) start = i + 1;
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

module.exports = { changelogSection };
