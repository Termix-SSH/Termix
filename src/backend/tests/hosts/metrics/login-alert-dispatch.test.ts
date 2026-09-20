import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";

// Load the production route without starting metrics polling or SSH services.
const source = readFileSync(
  new URL("../../../hosts/metrics/index.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "index.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const route = ast.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "app.post" &&
    node.expression.arguments[0]?.getText(ast) === '"/internal/login-alert"',
);
if (!route) throw new Error("Login event route is missing");
const notify = vi.fn();
const legacy = vi.fn().mockResolvedValue(undefined);
let handler: (req: unknown, res: unknown) => Promise<void>;
runInNewContext(
  ts.transpileModule(route.getText(ast), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    app: {
      post: (_path: string, callback: typeof handler) => {
        handler = callback;
      },
    },
    require: () => ({
      SystemCrypto: {
        getInstance: () => ({
          getInternalAuthToken: async () => "internal-test-token",
        }),
      },
    }),
    notifyAutomationInternalEvent: notify,
    AlertEngine: { getInstance: () => ({ evaluateUserLogin: legacy }) },
  },
);
const body = {
  hostId: 42,
  userId: "owner",
  sshUser: "alice",
  fromIp: "192.0.2.4",
};
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => vi.clearAllMocks());

it("delivers successful SSH login details to automations while retaining the legacy hook", async () => {
  const res = response();
  await handler(
    {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-internal-auth": "internal-test-token" },
      body,
    },
    res,
  );
  expect(notify).toHaveBeenCalledExactlyOnceWith("user_login", "owner", 42, {
    sshUser: "alice",
    fromIp: "192.0.2.4",
  });
  expect(legacy).toHaveBeenCalledExactlyOnceWith(
    42,
    "owner",
    "alice",
    "192.0.2.4",
  );
  expect(res.json).toHaveBeenCalledWith({ ok: true });
});

it.each([
  ["192.0.2.9", "internal-test-token"],
  ["127.0.0.1", "incorrect"],
])(
  "rejects untrusted login notifications (%s)",
  async (remoteAddress, token) => {
    const res = response();
    await handler(
      {
        socket: { remoteAddress },
        headers: { "x-internal-auth": token },
        body,
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(notify).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  },
);
