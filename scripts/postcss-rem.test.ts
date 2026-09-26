import { createRequire } from "node:module";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../postcss.config.cjs") as {
  plugins: Record<string, unknown>;
};
const pxtorem = require("postcss-pxtorem");

async function convert(css: string, from = "src/ui/index.css") {
  const result = await postcss([
    pxtorem(config.plugins["postcss-pxtorem"]),
  ]).process(css, { from });
  return result.css;
}

describe("interface size conversion", () => {
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
