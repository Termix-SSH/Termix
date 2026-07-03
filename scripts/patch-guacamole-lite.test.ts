import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("patch-guacamole-lite", () => {
  it("handles guacd dynamic argument requests", () => {
    const guacdClientPath = path.join(
      process.cwd(),
      "node_modules",
      "guacamole-lite",
      "lib",
      "GuacdClient.js",
    );

    const content = fs.readFileSync(guacdClientPath, "utf8");

    expect(content).toContain("sendRequiredArguments(params)");
    expect(content).toContain("opcode === 'required' || opcode === 'require'");
    expect(content).toContain("this.sendInstruction(['argv'");
    expect(content).toContain("this.sendInstruction(['blob'");
    expect(content).toContain("this.sendInstruction(['end'");
  });
});
