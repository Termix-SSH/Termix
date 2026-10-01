import { describe, expect, it, vi } from "vitest";
import {
  readService,
  requireService,
  serviceAvailable,
  SERVICE,
} from "../../src/backend/services.js";

function services(provided: Record<string, object>) {
  return {
    providers: (service: string) => (service in provided ? [""] : []),
    get: vi.fn((service: string) => provided[service]),
  } as never;
}

describe("optional services", () => {
  it("reads the user's history through terminal.history", async () => {
    const list = vi.fn(async () => [
      { command: "ls", executedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const history = await readService(
      services({ [SERVICE.history]: { list } }),
      SERVICE.history,
      (terminal) => terminal.list(4, 25),
    );

    expect(list).toHaveBeenCalledWith(4, 25);
    expect(history).toEqual([
      { command: "ls", executedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("answers null while the provider is off or refuses the user", async () => {
    expect(
      await readService(services({}), SERVICE.history, (terminal) =>
        terminal.list(4, 25),
      ),
    ).toBeNull();

    const refusing = {
      list: async () => {
        throw new Error("Missing permission");
      },
    };
    expect(
      await readService(
        services({ [SERVICE.history]: refusing }),
        SERVICE.history,
        (terminal) => terminal.list(4, 25),
      ),
    ).toBeNull();
  });

  it("says which plugin is missing when a write needs it", () => {
    expect(serviceAvailable(services({}), SERVICE.fleets)).toBe(false);
    expect(() => requireService(services({}), SERVICE.fleets)).toThrow(
      "The fleets plugin is not available",
    );
  });
});
