import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("snippet execution host access", () => {
  it("uses the shared-host-aware resolver", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../database/routes/snippets.ts"),
      "utf8",
    );
    const executeRoute = source.slice(
      source.indexOf('router.post(\n  "/execute"'),
    );

    expect(executeRoute).toContain(
      "const host = await resolveHostById(parseInt(hostId), userId)",
    );
    expect(executeRoute).not.toContain("host.userId !== userId");
  });
});
