import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  rows: [] as Array<{
    id: number;
    ownerId: string;
    recordId: string;
    values: Record<string, string | null>;
  }>,
  key: null as Buffer | null,
  saves: 0,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
  }),
  createCurrentFieldResealRepository: () => ({
    tables: () => [
      {
        name: "ssh_data",
        fields: { password: "password" },
        list: async (afterId: number) =>
          state.rows.filter((row) => row.id > afterId),
        update: async (id: number, values: Record<string, string>) => {
          const row = state.rows.find((r) => r.id === id)!;
          row.values = { ...row.values, ...values };
        },
      },
    ],
  }),
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => state.key },
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: async () => {
      state.saves++;
    },
  },
}));

const { FIELD_RESEAL_MARKER, runFieldResealMigration } =
  await import("../../upgrade/field-reseal-migration.js");
const { FieldCrypto } = await import("../../utils/field-crypto.js");

describe("runFieldResealMigration", () => {
  let dir: string;
  const original = process.env.DATA_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "reseal-boot-"));
    process.env.DATA_DIR = dir;
    state.settings.clear();
    state.saves = 0;
    state.key = crypto.randomBytes(32);
    state.rows = [
      {
        id: 3,
        ownerId: "u1",
        recordId: "3",
        values: {
          password: FieldCrypto.encryptField(
            "pw",
            state.key,
            "temp-1",
            "password",
          ),
        },
      },
    ];
  });

  afterEach(() => {
    process.env.DATA_DIR = original;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("moves rows, saves, backs up into the data folder and sets the marker", async () => {
    const result = await runFieldResealMigration();
    expect(result).toMatchObject({ resealed: 1, pending: 0 });
    expect(result!.backupFile!.startsWith(path.join(dir, "backups"))).toBe(
      true,
    );
    expect(state.saves).toBe(1);
    expect(state.settings.get(FIELD_RESEAL_MARKER)).toBe("done");
    expect(
      FieldCrypto.decryptField(
        state.rows[0].values.password!,
        state.key!,
        "3",
        "password",
      ),
    ).toBe("pw");

    // Done once: a later boot does nothing.
    expect(await runFieldResealMigration()).toBeNull();
  });

  it("keeps checking while a user's key has not opened", async () => {
    const key = state.key;
    state.key = null;
    expect(await runFieldResealMigration()).toMatchObject({ pending: 1 });
    expect(state.settings.has(FIELD_RESEAL_MARKER)).toBe(false);

    state.key = key;
    expect(await runFieldResealMigration()).toMatchObject({ resealed: 1 });
    expect(state.settings.get(FIELD_RESEAL_MARKER)).toBe("done");
  });
});
