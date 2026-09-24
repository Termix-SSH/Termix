import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface FleetsService {
  create: (input: { name: string }) => Promise<{ id: number; name: string }>;
  addMember: (fleetId: number, hostId: number) => Promise<void>;
}

describe("fleets.access", () => {
  it("needs fleets.manage to change a fleet", async () => {
    server = await startServer({ permissions: ["fleets.view"] });
    const service = server.mock.services.get("fleets.access") as FleetsService;

    await expect(
      server.mock.ctx.asUser("user-1", () => service.create({ name: "prod" })),
    ).rejects.toThrow("fleets.manage");
  });

  it("adds only hosts the caller can see", async () => {
    server = await startServer();
    const service = server.mock.services.get("fleets.access") as FleetsService;
    const run = <T>(fn: () => Promise<T>) =>
      server!.mock.ctx.asUser("user-1", fn);

    const fleet = await run(() => service.create({ name: "prod" }));
    await run(() => service.addMember(fleet.id, 10));
    await expect(run(() => service.addMember(fleet.id, 99))).rejects.toThrow(
      "Host not found",
    );
  });
});
