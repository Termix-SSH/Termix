import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listCommandHistory,
  setPluginServices,
} from "../../src/backend/services.js";

afterEach(() => setPluginServices(null));

describe("listCommandHistory", () => {
  it("reads the user's history through terminal.history", async () => {
    const list = vi.fn(async () => [
      { command: "ls", executedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const get = vi.fn(() => ({ list }));
    setPluginServices({ get, provide: vi.fn() } as never);

    const history = await listCommandHistory("user-1", 4, 25);

    expect(get).toHaveBeenCalledWith("terminal.history", { userId: "user-1" });
    expect(list).toHaveBeenCalledWith(4, 25);
    expect(history).toEqual([
      { command: "ls", executedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("answers null while the terminal is off or refuses the user", async () => {
    expect(await listCommandHistory("user-1", 4, 25)).toBeNull();

    setPluginServices({
      get: () => ({
        list: async () => {
          throw new Error("unavailable");
        },
      }),
      provide: vi.fn(),
    } as never);
    expect(await listCommandHistory("user-1", 4, 25)).toBeNull();
  });
});
