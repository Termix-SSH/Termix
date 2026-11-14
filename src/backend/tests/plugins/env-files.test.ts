import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_ENV_FILE_BYTES,
  readPluginEnvFile,
} from "../../plugins/env-files.js";

let root: string;
let dataDir: string;
let hostsFile: string;
let keyFile: string;

const manifest = (env: Array<Record<string, unknown>>) =>
  ({ id: "hosts-config", env }) as never;
const fileVar = (name: string) => ({ name, description: "x", file: true });

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tmx-env-file-"));
  dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  hostsFile = path.join(root, "hosts.yaml");
  fs.writeFileSync(hostsFile, "hosts: []\n");
  keyFile = path.join(root, "jwt.key");
  fs.writeFileSync(keyFile, "secret");
  fs.writeFileSync(path.join(dataDir, "db.sqlite.encrypted"), "db");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ctx.files.readEnvFile", () => {
  it("reads the file the admin named", async () => {
    const result = await readPluginEnvFile(
      manifest([fileVar("TERMIX_HOSTS_CONFIG")]),
      "TERMIX_HOSTS_CONFIG",
      { TERMIX_HOSTS_CONFIG: hostsFile, DATA_DIR: dataDir },
    );
    expect(result?.text).toBe("hosts: []\n");
    expect(result?.modifiedMs).toBeGreaterThan(0);
  });

  it("answers null when the variable is not set", async () => {
    expect(
      await readPluginEnvFile(
        manifest([fileVar("TERMIX_HOSTS_CONFIG")]),
        "TERMIX_HOSTS_CONFIG",
        {},
      ),
    ).toBeNull();
  });

  it("refuses a variable the manifest does not mark as a file", async () => {
    await expect(
      readPluginEnvFile(
        manifest([{ name: "TERMIX_HOSTS_CONFIG", description: "x" }]),
        "TERMIX_HOSTS_CONFIG",
        { TERMIX_HOSTS_CONFIG: hostsFile },
      ),
    ).rejects.toThrow(/"file": true/);
    await expect(
      readPluginEnvFile(manifest([]), "OTHER", { OTHER: hostsFile }),
    ).rejects.toThrow(/"file": true/);
  });

  it("never reads core's own key files or the data folder", async () => {
    await expect(
      readPluginEnvFile(
        manifest([fileVar("JWT_SECRET_FILE")]),
        "JWT_SECRET_FILE",
        {
          JWT_SECRET_FILE: keyFile,
        },
      ),
    ).rejects.toThrow(/Termix's own variables/);
    await expect(
      readPluginEnvFile(manifest([fileVar("MY_FILE")]), "MY_FILE", {
        MY_FILE: keyFile,
        JWT_SECRET_FILE: keyFile,
      }),
    ).rejects.toThrow(/Termix's own files/);
    await expect(
      readPluginEnvFile(manifest([fileVar("MY_FILE")]), "MY_FILE", {
        MY_FILE: path.join(dataDir, "db.sqlite.encrypted"),
        DATA_DIR: dataDir,
      }),
    ).rejects.toThrow(/data folder/);
    await expect(
      readPluginEnvFile(manifest([fileVar("MY_FILE")]), "MY_FILE", {
        MY_FILE: path.join(dataDir, "..", "data", "db.sqlite.encrypted"),
        DATA_DIR: dataDir,
      }),
    ).rejects.toThrow(/data folder/);
    await expect(
      readPluginEnvFile(manifest([fileVar("DATABASE_KEY")]), "DATABASE_KEY", {
        DATABASE_KEY: keyFile,
      }),
    ).rejects.toThrow(/Termix's own variables/);
  });

  it("refuses relative paths, folders, missing and oversized files", async () => {
    const read = (value: string) =>
      readPluginEnvFile(manifest([fileVar("MY_FILE")]), "MY_FILE", {
        MY_FILE: value,
      });
    await expect(read("hosts.yaml")).rejects.toThrow(/absolute/);
    await expect(read(root)).rejects.toThrow(/not a file/);
    await expect(read(path.join(root, "nope.yaml"))).rejects.toThrow(
      /does not exist/,
    );
    const big = path.join(root, "big.yaml");
    fs.writeFileSync(big, Buffer.alloc(MAX_ENV_FILE_BYTES + 1));
    await expect(read(big)).rejects.toThrow(/5 MB/);
  });
});
