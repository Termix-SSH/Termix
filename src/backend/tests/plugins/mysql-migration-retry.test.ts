import { beforeEach, describe, expect, it, vi } from "vitest";

const runStatement = vi.fn();
vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({ runStatement }));
vi.mock("../../utils/logger.js", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { pluginLogger: logger, databaseLogger: logger };
});

const { executeNamingFailure, mysqlErrno } =
  await import("../../plugins/data.js");

function mysqlError(errno: number) {
  return Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("mysql"), { errno }),
  });
}

beforeEach(() => runStatement.mockReset());

describe("MySQL migration retries", () => {
  it("finds the errno under the query error", () => {
    expect(mysqlErrno(mysqlError(1060))).toBe(1060);
    expect(mysqlErrno(new Error("x"))).toBeUndefined();
  });

  it("skips statements whose change is already there", async () => {
    runStatement
      .mockRejectedValueOnce(mysqlError(1060))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(mysqlError(1091));
    await executeNamingFailure(["a", "b", "c"]);
    expect(runStatement).toHaveBeenCalledTimes(3);
  });

  it("still fails on a real error and names the statement", async () => {
    runStatement
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(mysqlError(1553));
    await expect(executeNamingFailure(["a", "b"])).rejects.toThrow(
      /statement 2 of 2 failed/,
    );
  });
});
