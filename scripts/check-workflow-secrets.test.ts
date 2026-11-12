import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { checkWorkflow, checkDir } = require("./check-workflow-secrets.cjs");

describe("check-workflow-secrets", () => {
  it("passes the repo's workflows", () => {
    expect(checkDir(path.resolve(__dirname, "../.github/workflows"))).toEqual(
      [],
    );
  });

  it("flags the retired PAT", () => {
    const text = `
on: workflow_dispatch
jobs:
  go:
    runs-on: ubuntu-latest
    environment: build
    steps:
      - env:
          GH_TOKEN: \${{ secrets.TERMIX_PAT }}
        run: gh api user
`;
    expect(checkWorkflow("x.yml", text)).toEqual([
      "x.yml: uses TERMIX_PAT, mint a Termix CI App token",
    ]);
  });

  it("flags a secret read outside an environment", () => {
    const text = `
on: push
jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - env:
          KEY: \${{ secrets.TERMIX_LLM_API_KEY }}
        run: echo
`;
    expect(checkWorkflow("x.yml", text)).toEqual([
      "x.yml go: reads TERMIX_LLM_API_KEY without an environment",
    ]);
  });

  it("allows GITHUB_TOKEN and inherited secrets anywhere", () => {
    const text = `
on: push
jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh api user
  call:
    uses: ./.github/workflows/docker.yml
    secrets: inherit
`;
    expect(checkWorkflow("x.yml", text)).toEqual([]);
  });

  it("flags environment jobs in pull_request_target workflows", () => {
    const text = `
on:
  pull_request_target:
jobs:
  go:
    runs-on: ubuntu-latest
    environment: build
    steps:
      - run: echo
`;
    expect(checkWorkflow("x.yml", text)).toEqual([
      "x.yml go: environment job in a pull_request_target workflow",
    ]);
  });
});
