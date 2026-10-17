import * as fs from "node:fs";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import Database from "better-sqlite3";
import ts from "typescript";
import { expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../../database/database.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "database.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const route = ast.statements.find(
  (s) =>
    ts.isExpressionStatement(s) &&
    ts.isCallExpression(s.expression) &&
    s.expression.arguments[0]?.getText(ast) === '"/database/import"',
) as ts.ExpressionStatement;
const batched = (route.expression as ts.CallExpression)
  .arguments[3] as ts.CallExpression;
const callback = batched.arguments[0];

const dir = mkdtempSync(join(tmpdir(), "termix-import-route-"));

function exportFile(): string {
  const path = join(dir, `export-${Math.random()}.db`);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ssh_credentials (id INTEGER, name TEXT, username TEXT);
    CREATE TABLE ssh_data (id INTEGER, ip TEXT, port INTEGER, username TEXT, credential_id INTEGER);
    INSERT INTO ssh_credentials VALUES (7, 'fresh', 'root'), (8, 'kept', 'admin');
    INSERT INTO ssh_data VALUES
      (1, '10.0.0.1', 22, 'root', 7),
      (2, '10.0.0.2', 22, 'root', 8),
      (3, '10.0.0.3', 22, 'root', 99),
      (4, '10.0.0.4', 22, 'root', NULL);
  `);
  db.close();
  return path;
}

async function invoke(path: string, user: unknown = { isExternal: false }) {
  const writes: string[] = [];
  const events: Array<[string, unknown]> = [];
  const hosts: Array<Record<string, unknown>> = [];
  const importHostProtocolLogins = vi.fn();
  const handler = runInNewContext(
    ts.transpileModule(`(${callback.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      fs,
      Buffer,
      Database,
      parseUserAgent: () => ({ type: "web" }),
      createCurrentUserRepository: () => ({ findById: async () => user }),
      DataCrypto: { getUserDataKey: () => Buffer.from("key") },
      apiLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
      },
      createCurrentCredentialRepository: () => ({
        findIdForImportIdentity: async (_: string, name: string) =>
          name === "kept" ? 42 : null,
        createEncryptedForUser: async () => {
          writes.push("credential");
          return { id: 100 };
        },
      }),
      createCurrentHostRepository: () => ({
        existsForImportIdentity: async () => false,
        createEncryptedForUser: async (_: string, host: never) => {
          writes.push("host");
          hosts.push(host);
          return { id: 500 + hosts.length };
        },
      }),
      legacyStatusCheck: () => ({}),
      sshOptionsForWrite: () => null,
      applyHostDefaultsToWrite: async () => ({}),
      applyPluginHostImportSettings: async () => {},
      importedHostPluginSettings: () => ({}),
      importHostProtocolLogins,
      applyDefaultsAfterHostWrites: async () => {},
      importUserPluginRows: async () => ({
        imported: 0,
        skipped: 0,
        errors: [],
      }),
      importHostDefaults: async () => ({ imported: 0, skipped: 0 }),
      DatabaseSaveTrigger: { forceSave: async () => {} },
      getErrorMessage: (error: Error) => error.message,
      pluginEvents: {
        emit: (topic: string, payload: unknown) =>
          events.push([topic, payload]),
      },
      TOPICS: { hostCreated: "host.created" },
    },
  );
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  await handler(
    { userId: "user-1", file: { path, originalname: "export.db" } },
    res,
  );
  return { res, writes, hosts, events, importHostProtocolLogins };
}

it("points imported hosts at the credentials imported with them", async () => {
  const { res, writes, hosts, importHostProtocolLogins } =
    await invoke(exportFile());

  expect(res.status).not.toHaveBeenCalled();
  expect(writes).toEqual(["credential", "host", "host", "host", "host"]);
  expect(hosts.map((host) => host.credentialId)).toEqual([100, 42, null, null]);
  expect([...importHostProtocolLogins.mock.calls[0][4]]).toEqual([
    [7, 100],
    [8, 42],
  ]);
});

it("publishes host.created once for each imported host", async () => {
  const { events } = await invoke(exportFile());

  expect(events).toEqual(
    [501, 502, 503, 504].map((hostId) => [
      "host.created",
      { hostId, userId: "user-1" },
    ]),
  );
});

it("removes the uploaded file when the user is gone", async () => {
  const path = exportFile();
  const { res } = await invoke(path, null);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(existsSync(path)).toBe(false);
});

it("removes the uploaded file when it is not a SQLite database", async () => {
  const path = join(dir, "not-sqlite.db");
  writeFileSync(path, "definitely not a database");
  const { res } = await invoke(path);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(existsSync(path)).toBe(false);
});

it("removes the uploaded file after a successful import", async () => {
  const path = exportFile();
  await invoke(path);

  expect(existsSync(path)).toBe(false);
});
