import { describe, expect, it } from "vitest";
import { validateThemeCss } from "../../plugins/manifest.js";

describe("validateThemeCss", () => {
  it("accepts token rules scoped under the theme class", () => {
    const css = `
      /* Paper */
      .paper { --background: #fff; --foreground: #111; }
      :root.paper, html.paper .card { --card: #f8f8f8; }
      @media (prefers-reduced-motion: reduce) {
        .paper * { transition: none; }
      }
      @supports (color: oklch(0 0 0)) { .paper { --border: oklch(0.9 0 0); } }
      .paper .logo { background: url("logo.svg") no-repeat; }
      .paper .dot { background: url(data:image/png;base64,AAAA); }
    `;
    expect(validateThemeCss(css, "paper")).toEqual([]);
  });

  it("refuses selectors outside the theme", () => {
    const errors = validateThemeCss(
      ".paper { --a: 1 } body { color: red } .paperish { --b: 2 } .dark { --c: 3 }",
      "paper",
    );
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('"body"');
  });

  it("refuses anything that loads or runs", () => {
    const errors = validateThemeCss(
      `@import url("https://evil.example/x.css");
       .paper { background: url(https://evil.example/a.png); }
       .paper { background: url(//evil.example/a.png); }
       .paper { width: expression(alert(1)); }
       .paper { background: url(javascript:alert(1)); }
       .paper { behavior: url(x.htc); }
       @font-face { font-family: x; src: url(x.woff2); }
       @keyframes spin { from { opacity: 0 } }`,
      "paper",
    );
    const has = (text: string) => errors.some((e) => e.includes(text));
    expect(has("@import is not allowed")).toBe(true);
    expect(has("url(https://evil.example/a.png) points outside")).toBe(true);
    expect(has("url(//evil.example/a.png) points outside")).toBe(true);
    expect(has("expression() is not allowed")).toBe(true);
    expect(has("javascript: is not allowed")).toBe(true);
    expect(has("Script bindings")).toBe(true);
    expect(has("@font-face is not allowed")).toBe(true);
    expect(has("@keyframes is not allowed")).toBe(true);
  });

  it("refuses nested rules and broken braces", () => {
    expect(validateThemeCss(".paper { .x { color: red } }", "paper")).toEqual([
      'Nested rules are not allowed in ".paper"',
    ]);
    expect(validateThemeCss(".paper { color: red", "paper")).toEqual([
      "A rule is missing its closing brace",
    ]);
  });

  it("refuses root paths, which reach the plugin's or core's own routes", () => {
    const errors = validateThemeCss(
      `.paper input[value^="a"] { background: url(/plugin-api/paper/x?a); }
       .paper .y { background: url("/users/info"); }
       .paper .z { background: url(\\\\evil.example/a.png); }`,
      "paper",
    );
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.includes("points outside"))).toBe(true);
  });

  it("refuses paths that climb out of the plugin", () => {
    const errors = validateThemeCss(
      ".paper { background: url(../../../plugin-api/paper/x); }",
      "paper",
    );
    expect(errors).toEqual([
      "url(../../../plugin-api/paper/x) points outside the plugin",
    ]);
    expect(
      validateThemeCss(".paper { background: url(img/../logo.svg); }", "paper"),
    ).toEqual([]);
  });

  it("sees through CSS escapes", () => {
    const has = (css: string, text: string) =>
      validateThemeCss(css, "paper").some((e) => e.includes(text));
    expect(
      has(
        ".paper { background: url(\\2f\\2f evil.example/a.png); }",
        "points outside",
      ),
    ).toBe(true);
    expect(
      has(
        ".paper { background: u\\72l(https://evil.example/a.png); }",
        "points outside",
      ),
    ).toBe(true);
    expect(
      has(
        '.paper { background: url("ht\\74ps://evil.example/a"); }',
        "points outside",
      ),
    ).toBe(true);
    expect(has(".paper { width: expr\\65ssion(1); }", "expression()")).toBe(
      true,
    );
  });

  it("refuses image-set and src() strings that load from elsewhere", () => {
    const has = (css: string) =>
      validateThemeCss(css, "paper").some((e) => e.includes("points outside"));
    expect(
      has('.paper { background: image-set("https://evil.example/a.png" 1x); }'),
    ).toBe(true);
    expect(
      has(
        '.paper { background: -webkit-image-set("//evil.example/a.png" 1x); }',
      ),
    ).toBe(true);
    expect(has('.paper { background: src("https://evil.example/a"); }')).toBe(
      true,
    );
    expect(
      validateThemeCss(
        '.paper { background: image-set("logo.png" 1x, url(logo@2x.png) 2x); }',
        "paper",
      ),
    ).toEqual([]);
  });

  it("allows only image and font data urls", () => {
    expect(
      validateThemeCss(
        ".paper { background: url(data:text/html,<b>x</b>); }",
        "paper",
      ),
    ).toEqual(["url(data:text/html,<b>x</b>) is not an image or font"]);
    expect(
      validateThemeCss(
        '.paper { background: url("data:image/svg+xml;utf8,<svg/>"); }',
        "paper",
      ),
    ).toEqual([]);
  });

  it("does not trip on braces inside strings", () => {
    expect(
      validateThemeCss('.paper .x::after { content: "{ }"; }', "paper"),
    ).toEqual([]);
  });
});
