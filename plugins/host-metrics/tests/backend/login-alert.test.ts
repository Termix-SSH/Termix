/**
 * SSH login alerts reach automations.
 *
 * This used to be POST /internal/login-alert on this plugin's own port,
 * guarded by a localhost IP check plus a shared internal token, and the tests
 * here covered both of those plus the middleware ordering bug that once made
 * every alert 401. A4 replaced the call with an in-process event, so the
 * transport, the shared secret and the ordering hazard are all gone; what is
 * left to assert is that the handler forwards the right thing and ignores a
 * payload it cannot use.
 *
 * The route module pulls in the whole metrics stack, so this extracts the
 * handler from source rather than importing it, the same way the old test did.
 */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../../src/backend/routes.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "routes.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);

const declaration = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.getText(ast) === "onHostLogin",
);
if (!declaration) throw new Error("onHostLogin is missing");

const notify = vi.fn();
const context: Record<string, unknown> = {
  notifyAutomationInternalEvent: notify,
  exports: {},
};

runInNewContext(
  ts.transpileModule(declaration.getText(ast), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  context,
);

const onHostLogin = context.onHostLogin as (payload: {
  hostId: number;
  userId: string;
  sshUser: string;
  fromIp: string;
}) => void;

beforeEach(() => vi.clearAllMocks());

it("delivers successful SSH login details to automations", () => {
  onHostLogin({
    hostId: 42,
    userId: "owner",
    sshUser: "alice",
    fromIp: "192.0.2.4",
  });

  expect(notify).toHaveBeenCalledExactlyOnceWith("user_login", "owner", 42, {
    sshUser: "alice",
    fromIp: "192.0.2.4",
  });
});

it.each([
  ["no host", { hostId: 0, userId: "owner", sshUser: "a", fromIp: "1.2.3.4" }],
  ["no user", { hostId: 42, userId: "", sshUser: "a", fromIp: "1.2.3.4" }],
])("ignores an unusable payload (%s)", (_label, payload) => {
  onHostLogin(payload as Parameters<typeof onHostLogin>[0]);

  expect(notify).not.toHaveBeenCalled();
});
