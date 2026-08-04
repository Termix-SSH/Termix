import { describe, expect, it } from "vitest";
import {
  escapeCsvField,
  exportFilename,
  toCsv,
  toNdjson,
} from "../../utils/audit-export.js";
import type { AuditLogRecord } from "../../database/repositories/audit-log-repository.js";

function entry(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    id: 1,
    userId: "u-1",
    username: "alice",
    action: "delete_host",
    resourceType: "host",
    resourceId: "9",
    resourceName: "prod-db",
    details: null,
    ipAddress: "203.0.113.9",
    userAgent: "Mozilla/5.0",
    success: true,
    errorMessage: null,
    timestamp: "2026-07-28 10:00:00",
    ...overrides,
  } as AuditLogRecord;
}

describe("escapeCsvField", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvField("prod-db")).toBe("prod-db");
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField(true)).toBe("true");
  });

  it("renders null and undefined as empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values containing commas or newlines", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises spreadsheet formulas", () => {
    // An audit entry can carry an attacker-chosen resource name; without this
    // the exported file executes it when opened.
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
    expect(escapeCsvField("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(escapeCsvField("-2+3")).toBe("'-2+3");
    expect(escapeCsvField("@import")).toBe("'@import");
  });

  it("still quotes a formula that also contains a comma", () => {
    expect(escapeCsvField("=A1,B2")).toBe(`"'=A1,B2"`);
  });
});

describe("toCsv", () => {
  it("writes a header even with no rows", () => {
    expect(toCsv([])).toBe(
      "id,timestamp,username,userId,action,resourceType,resourceId,resourceName,success,ipAddress,userAgent,errorMessage,details\n",
    );
  });

  it("writes one line per entry in column order", () => {
    const lines = toCsv([entry(), entry({ id: 2, username: "bob" })])
      .trim()
      .split("\n");

    expect(lines).toHaveLength(3);
    expect(
      lines[1].startsWith("1,2026-07-28 10:00:00,alice,u-1,delete_host"),
    ).toBe(true);
    expect(lines[2].startsWith("2,")).toBe(true);
  });

  it("keeps a detached entry readable", () => {
    const line = toCsv([entry({ userId: null })])
      .trim()
      .split("\n")[1];

    // username survives so the row still names who acted.
    expect(line).toContain("alice");
    expect(line.split(",")[3]).toBe("");
  });
});

describe("toNdjson", () => {
  it("emits one parseable object per line", () => {
    const out = toNdjson([entry(), entry({ id: 2 })]);
    const parsed = out
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].action).toBe("delete_host");
    expect(parsed[1].id).toBe(2);
  });

  it("returns nothing for an empty set", () => {
    expect(toNdjson([])).toBe("");
  });
});

describe("exportFilename", () => {
  it("is filesystem-safe and carries the timestamp", () => {
    const name = exportFilename("csv", new Date("2026-07-28T10:11:12.000Z"));

    expect(name).toBe("termix-audit-2026-07-28-10-11-12.csv");
    expect(name).not.toMatch(/[:\s]/);
  });

  it("uses the ndjson extension for the streaming format", () => {
    expect(exportFilename("ndjson", new Date("2026-07-28T10:11:12.000Z"))).toBe(
      "termix-audit-2026-07-28-10-11-12.ndjson",
    );
  });
});
