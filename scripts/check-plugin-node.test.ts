import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { check } = require("./check-plugin-node.cjs");

const hash = "a".repeat(64);
const pin = {
  version: "26.13.1",
  builds: {
    "linux-x64": { file: "node-v26.13.1-linux-x64.tar.xz", sha256: hash },
  },
};

describe("check-plugin-node", () => {
  it("passes when the desktop pin matches the server image", () => {
    expect(
      check(
        pin,
        "FROM --platform=$BUILDPLATFORM node:26-slim@sha256:x AS deps\nFROM node:26-slim",
      ),
    ).toEqual([]);
  });

  it("fails on another major, a stray file or a bad hash", () => {
    expect(check(pin, "FROM node:24-slim")).toHaveLength(1);
    expect(
      check(
        {
          version: "26.13.1",
          builds: {
            "linux-x64": { file: "node-v26.1.0-linux-x64.tar.xz", sha256: "x" },
          },
        },
        "FROM node:26-slim",
      ),
    ).toHaveLength(2);
    expect(check(pin, "FROM debian")).toHaveLength(1);
  });
});
