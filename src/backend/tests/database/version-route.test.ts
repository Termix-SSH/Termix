import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../../database/database.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "database.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const route = ast.statements.find(
  (s) =>
    ts.isExpressionStatement(s) &&
    ts.isCallExpression(s.expression) &&
    s.expression.arguments[0]?.getText(ast) === '"/version"',
) as ts.ExpressionStatement;
const callback = (route.expression as ts.CallExpression).arguments[2];

async function invoke(fetchGitHubAPI: ReturnType<typeof vi.fn>) {
  const handler = runInNewContext(
    ts.transpileModule(`(${callback.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      process: { env: { VERSION: "2.7.1" } },
      databaseLogger: { warn: vi.fn(), error: vi.fn() },
      fetchGitHubAPI,
      REPO_OWNER: "Termix-SSH",
      REPO_NAME: "Termix",
      compareSemver: () => -1,
    },
  );
  const res = { json: vi.fn(), status: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  await handler({ query: {} }, res);
  return res;
}

it("keeps the installed version when the update service is unreachable", async () => {
  const res = await invoke(vi.fn().mockRejectedValue(new Error("offline")));
  expect(res.json).toHaveBeenCalledWith({
    localVersion: "2.7.1",
    status: "unknown",
  });
  expect(res.status).not.toHaveBeenCalled();
});
it("keeps the installed version if the release has no parseable version", async () => {
  const res = await invoke(
    vi.fn().mockResolvedValue({ data: { tag_name: "nightly" } }),
  );
  expect(res.json).toHaveBeenCalledWith({
    localVersion: "2.7.1",
    status: "unknown",
  });
});
it("still reports a newer release when the check succeeds", async () => {
  const res = await invoke(
    vi.fn().mockResolvedValue({ data: { tag_name: "2.8.0" } }),
  );
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      localVersion: "2.7.1",
      status: "requires_update",
      remoteVersion: "2.8.0",
    }),
  );
});
