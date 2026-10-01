import { createRequire } from "node:module";
import postcss, { type AcceptedPlugin } from "postcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../postcss.config.cjs") as {
  plugins: AcceptedPlugin[];
};

async function convert(css: string, from = "src/ui/index.css") {
  const result = await postcss(config.plugins).process(css, { from });
  return result.css;
}

describe("interface size conversion", () => {
  it("preserves circular radii emitted in exponent notation", async () => {
    expect(await convert(".a{border-radius:3.40282e38px}")).toBe(
      ".a{border-radius:calc(infinity * 1px)}",
    );
  });

  it("turns px into rem against the 14px Normal root", async () => {
    expect(await convert(".a{font-size:10px;width:280px}")).toBe(
      ".a{font-size:0.71429rem;width:20rem}",
    );
  });

  it("keeps hairlines, breakpoints and the root size rules in px", async () => {
    expect(await convert(".b{border-width:1px}")).toBe(".b{border-width:1px}");
    expect(await convert("@media (min-width:768px){.c{gap:7px}}")).toBe(
      "@media (min-width:768px){.c{gap:0.5rem}}",
    );
    expect(await convert("html.fs-lg{font-size:17px}")).toBe(
      "html.fs-lg{font-size:17px}",
    );
  });

  it("leaves third-party CSS alone", async () => {
    expect(
      await convert(
        ".xterm{padding:4px}",
        "node_modules/@xterm/xterm/css/xterm.css",
      ),
    ).toBe(".xterm{padding:4px}");
  });
});
