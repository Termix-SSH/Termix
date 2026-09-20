import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

it("returns the minted token without waiting for a connection that needs that token", async () => {
  const source = readFileSync(
    new URL("../../../hosts/guacamole/routes.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "routes.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const route = ast.statements.find(
    (s) =>
      ts.isExpressionStatement(s) &&
      ts.isCallExpression(s.expression) &&
      s.expression.arguments[0]?.getText(ast) === '"/connect-host/:hostId"',
  ) as ts.ExpressionStatement;
  const callback = (route.expression as ts.CallExpression)
    .arguments[1] as ts.ArrowFunction;
  const block = (callback.body as ts.Block).statements[0] as ts.TryStatement;
  const index = block.tryBlock.statements
    .map((s, i) => (ts.isSwitchStatement(s) ? i : -1))
    .filter((i) => i >= 0)
    .at(-1)!;
  expect(index).toBeGreaterThan(-1);
  const tail = block.tryBlock.statements
    .slice(index + 1)
    .map((s) => s.getText(ast))
    .join("\n");
  const json = vi.fn();
  const wait = vi.fn(() => {
    throw new Error("Client has not received the token yet");
  });
  await runInNewContext(
    ts.transpileModule(`(async () => { ${tail} })()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      waitForGuacdOpen: wait,
      token: "minted-token",
      termixConnectId: "correlation-id",
      req: {},
      getRequestMeta: () => ({}),
      logAudit: async () => {},
      getAuditUsername: async () => "owner",
      userId: "owner",
      connectionType: "rdp",
      hostId: 7,
      hostname: "host",
      port: 3389,
      res: { json },
    },
  );
  expect(wait).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith({
    token: "minted-token",
    termixConnectId: "correlation-id",
    guacamoleConnectionId: null,
  });
});

it("only reveals the live session ID to its owner", () => {
  const source = readFileSync(
    new URL("../../../hosts/guacamole/guacamole-server.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "server.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const fn = ast.statements.find(
    (s) =>
      ts.isFunctionDeclaration(s) &&
      s.name?.text === "getGuacSessionByConnectId",
  )!;
  const info = { ownerUserId: "owner", guacamoleConnectionId: "guacd-id" };
  const context = {
    exports: {} as Record<string, (id: string, user: string) => unknown>,
    guacSessionByConnectId: new Map([["connect-id", info]]),
  };
  runInNewContext(
    ts.transpileModule(fn.getText(ast), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  const lookup = context.exports.getGuacSessionByConnectId;
  expect(lookup("connect-id", "owner")).toEqual(info);
  expect(lookup("connect-id", "other")).toBeNull();
  expect(lookup("pending", "owner")).toBeNull();
});
