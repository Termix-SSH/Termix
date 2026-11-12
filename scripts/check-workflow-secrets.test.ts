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

  it("allows GITHUB_TOKEN anywhere and named secrets to a local workflow", () => {
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
    secrets:
      DOCKERHUB_TERMIXSSH_TOKEN: \${{ secrets.DOCKERHUB_TERMIXSSH_TOKEN }}
`;
    expect(checkWorkflow("x.yml", text)).toEqual([]);
  });

  it("flags secrets: inherit", () => {
    const text = `
on: push
jobs:
  call:
    uses: ./.github/workflows/docker.yml
    secrets: inherit
`;
    expect(checkWorkflow("x.yml", text)).toEqual([
      "x.yml call: secrets: inherit, pass each secret by name",
    ]);
  });

  it("flags named secrets passed to another repo's workflow", () => {
    const text = `
on: push
jobs:
  call:
    uses: someone/else/.github/workflows/x.yml@main
    secrets:
      KEY: \${{ secrets.TERMIX_LLM_API_KEY }}
`;
    expect(checkWorkflow("x.yml", text)).toEqual([
      "x.yml call: reads TERMIX_LLM_API_KEY without an environment",
    ]);
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

  it("flags installs that run package scripts", () => {
    const text = `
on: pull_request
jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm ci --ignore-scripts
      - run: npm run ci:install
      - run: npm install -g npm@11.21.2
`;
    expect(checkWorkflow("x.yml", text)).toEqual([
      "x.yml go: install scripts on, use npm run ci:install or --ignore-scripts",
    ]);
  });
});
