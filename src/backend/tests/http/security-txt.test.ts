import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { securityTxt, securityTxtHandler } from "../../http/security-txt.js";

const REQUIRED = ["Contact", "Expires"];

function fields(body: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf(": ");
    const name = line.slice(0, at);
    out.set(name, [...(out.get(name) ?? []), line.slice(at + 2)]);
  }
  return out;
}

describe("security.txt", () => {
  it("has the RFC 9116 required fields once each", () => {
    const parsed = fields(securityTxt());
    for (const name of REQUIRED) expect(parsed.get(name)).toHaveLength(1);
    for (const contact of parsed.get("Contact")!) {
      expect(contact.startsWith("https://")).toBe(true);
    }
  });

  it("expires in the future but less than a year out", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const expires = new Date(fields(securityTxt(now)).get("Expires")![0]);
    const days = (expires.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(90);
    expect(days).toBeLessThan(365);
    expect(expires.toISOString()).toBe("2027-05-12T00:00:00.000Z");
  });

  it("is served as plain text without a login", async () => {
    const app = express();
    app.get("/.well-known/security.txt", securityTxtHandler);
    const res = await request(app).get("/.well-known/security.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain; charset=utf-8/);
    expect(res.text).toContain("Contact: https://");
  });
});
