import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOpenApi,
  hasOpenApiPaths,
  TERMIX_SECURITY_SCHEMES,
} from "@termix-ssh/plugin-sdk/openapi";

let dir: string | null = null;

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function source(files: Record<string, string>): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-openapi-"));
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

describe("buildOpenApi", () => {
  it("reads @openapi blocks from TypeScript sources", async () => {
    const root = source({
      "routes.ts": [
        "/**",
        " * @openapi",
        " * /plugin-api/sample/items:",
        " *   get:",
        " *     summary: List items",
        " *     responses:",
        " *       200:",
        " *         description: The items",
        " */",
        'router.get("/items", handler);',
      ].join("\n"),
    });
    const spec = await buildOpenApi({
      title: "Sample API",
      version: "1.2.3",
      files: [path.join(root, "*.ts")],
      tags: [{ name: "Sample" }],
    });
    expect(hasOpenApiPaths(spec)).toBe(true);
    expect(Object.keys(spec.paths ?? {})).toEqual(["/plugin-api/sample/items"]);
    expect(spec).toMatchObject({
      openapi: "3.0.3",
      info: { title: "Sample API", version: "1.2.3" },
      tags: [{ name: "Sample" }],
      components: { securitySchemes: TERMIX_SECURITY_SCHEMES },
    });
  });

  it("returns a spec with no paths when nothing is documented", async () => {
    const root = source({ "index.ts": "export const x = 1;" });
    const spec = await buildOpenApi({
      title: "Empty",
      version: "1.0.0",
      files: [path.join(root, "*.ts")],
    });
    expect(hasOpenApiPaths(spec)).toBe(false);
  });
});
