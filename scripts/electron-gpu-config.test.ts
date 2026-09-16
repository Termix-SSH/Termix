import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
const source = readFileSync(
  new URL("../electron/main.cjs", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "main.cjs",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const statement = ast.statements.find(
  (s) =>
    ts.isIfStatement(s) &&
    s.thenStatement.getText(ast).includes("app.disableHardwareAcceleration()"),
);
it.each([
  ["linux", undefined, false],
  ["linux", "1", true],
  ["linux", "0", false],
  ["win32", undefined, true],
])(
  "applies the startup GPU policy on %s with opt-out %s",
  (platform, value, expected) => {
    const disableHardwareAcceleration = vi.fn();
    runInNewContext(statement!.getText(ast), {
      process: { platform, env: { ELECTRON_DISABLE_GPU: value } },
      app: { disableHardwareAcceleration },
    });
    expect(disableHardwareAcceleration).toHaveBeenCalledTimes(expected ? 1 : 0);
  },
);
