// Turns attack results into pass or fail against the expectation table.

/**
 * results: { [id]: { worked: boolean, detail?: string } }
 * expectations: { [id]: { expect, why, na? } }
 * options.channel: "fork" or "stdio"; options.flags: extra na tags in effect
 * options.required: ids that must have a result (default: every expectation)
 */
export function evaluate(results, expectations, options = {}) {
  const tags = new Set([options.channel, ...(options.flags ?? [])]);
  const rows = [];
  const required = options.required ?? Object.keys(expectations);
  for (const [id, result] of Object.entries(results)) {
    const expected = expectations[id];
    if (!expected) {
      rows.push({ id, status: "fail", why: "attack with no expectation" });
      continue;
    }
    if (result.error) {
      rows.push({
        id,
        status: "fail",
        why: "could not run",
        detail: result.detail,
      });
      continue;
    }
    const na = String(result.detail ?? "").startsWith("n/a");
    if (na) {
      const allowed = (expected.na ?? []).some((tag) => tags.has(tag));
      rows.push({
        id,
        status: allowed ? "skip" : "fail",
        why: allowed ? result.detail : `could not run: ${result.detail}`,
      });
      continue;
    }
    if (expected.expect === "limit") {
      rows.push({
        id,
        status: "limit",
        why: `${expected.why}${result.worked ? " (it got through)" : ""}`,
        detail: result.detail,
      });
      continue;
    }
    const ok =
      expected.expect === "works" ? result.worked === true : !result.worked;
    rows.push({
      id,
      status: ok ? "pass" : "fail",
      why:
        expected.expect === "works"
          ? `control: ${expected.why}`
          : `must not ${expected.why}`,
      detail: result.detail,
    });
  }
  for (const id of required) {
    if (id in results) continue;
    const expected = expectations[id];
    const skipped = (expected?.na ?? []).some((tag) => tags.has(tag));
    rows.push({
      id,
      status: skipped ? "skip" : "fail",
      why: skipped ? "not on this channel" : "no result",
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export function summarize(rows) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  return {
    pass: count("pass"),
    fail: count("fail"),
    skip: count("skip"),
    limit: count("limit"),
    failed: rows.filter((row) => row.status === "fail"),
  };
}
