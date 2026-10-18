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

  it("does not trip on braces inside strings", () => {
    expect(
      validateThemeCss('.paper .x::after { content: "{ }"; }', "paper"),
    ).toEqual([]);
  });
});
