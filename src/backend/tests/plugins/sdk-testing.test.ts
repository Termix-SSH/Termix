/**
 * The SDK's test helpers, against a fixture plugin in a temp directory.
 *
 * Plugin suites rely on createTestDb applying migrations exactly as the
 * server does and on createMockCtx enforcing permissions, so a regression in
 * either would pass every plugin's tests while proving nothing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptLegacyTable,
  defineTable,
  id,
  refUser,
  text,
} from "@termix/plugin-sdk/db";
import { adoptTableSql } from "@termix/plugin-sdk/ddl";
import { createMockCtx, createTestDb } from "@termix/plugin-sdk/testing";

let root: string;
let pluginDir: string;

const notes = adoptLegacyTable(
  "fleets",
  defineTable("fleets", { id: id(), userId: refUser(), name: text() }),
);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-sdk-testing-"));
  // The directory name is the plugin id, as it is in plugins/.
  pluginDir = path.join(root, "fleets");
  fs.mkdirSync(path.join(pluginDir, "migrations", "sqlite"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(pluginDir, "migrations", "sqlite", "0001_adopt.sql"),
    adoptTableSql("sqlite", "fleets", notes).join("\n"),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("createTestDb", () => {
  it("applies the plugin's migrations after the before hook", async () => {
    const db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('u1')");
        sqlite.exec(
          "CREATE TABLE fleets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, name TEXT)",
        );
        sqlite.exec("INSERT INTO fleets (user_id, name) VALUES ('u1', 'kept')");
      },
    });

    expect(db.applied).toEqual(["0001_adopt"]);
    expect(db.sqlite.prepare("SELECT name FROM p_fleets_fleets").all()).toEqual(
      [{ name: "kept" }],
    );
    db.close();
  });

  it("hands back a database a plugin can query through define and client", async () => {
    const db = await createTestDb(pluginDir);
    db.sqlite.exec("INSERT INTO users (id) VALUES ('u1')");

    const table = (await db.database.define(notes)) as never;
    const drizzle = (await db.database.client()) as {
      insert: (t: never) => { values: (v: object) => Promise<unknown> };
      select: () => { from: (t: never) => Promise<unknown[]> };
    };
    await drizzle.insert(table).values({ userId: "u1", name: "n" });
    await db.database.persist();

    expect(await drizzle.select().from(table)).toEqual([
      { id: 1, userId: "u1", name: "n" },
    ]);
    expect(db.persisted).toBe(1);
    db.close();
  });
});

describe("createMockCtx permissions", () => {
  const respond = () => {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(body: unknown) {
        res.body = body;
        return body;
      },
    };
    return res;
  };

  it("passes everything when no permissions are given", async () => {
    const { ctx } = createMockCtx({ pluginId: "demo" });
    expect(await ctx.rbac.has("use")).toBe(true);
  });

  it("resolves short names and refuses what the user does not hold", async () => {
    const { ctx } = createMockCtx({
      pluginId: "demo",
      permissions: ["demo.use", "hosts.view"],
    });

    expect(await ctx.rbac.has("use")).toBe(true);
    expect(await ctx.rbac.has("hosts.view")).toBe(true);
    expect(await ctx.rbac.has("manage")).toBe(false);

    const res = respond();
    let passed = false;
    ctx.rbac.require("manage")({} as never, res as never, () => {
      passed = true;
    });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ required: "demo.manage" });
  });

  it("uses the router factory and follows setActor", () => {
    const router = {};
    const mock = createMockCtx({
      pluginId: "demo",
      capabilities: ["network:serve"],
      router: () => router,
    });
    expect(mock.ctx.http.router()).toBe(router);

    mock.setActor("u9");
    expect(mock.ctx.currentActor()).toBe("u9");
  });
});
