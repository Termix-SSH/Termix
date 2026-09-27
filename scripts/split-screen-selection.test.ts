import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import {
  assignTabsToSplit,
  createSplitConfig,
} from "../src/ui/shell/splitTabUtils";
import type { Tab, SplitMode } from "../src/types/ui-types";

const source = readFileSync(
  new URL("../src/ui/AppShell.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "AppShell.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functions: string[] = [];
function visit(node: ts.Node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ["splitTabQuick", "selectSplitMode"].includes(node.name?.text ?? "")
  )
    functions.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(functions.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function shell(crypto: object, activeTabId = "terminal-1") {
  let tabs = [
    { id: "dashboard", type: "dashboard" },
    { id: "terminal-1", type: "terminal" },
    { id: "terminal-2", type: "terminal" },
  ] as Tab[];
  const setActiveTabId = vi.fn();
  const setSplitMode = vi.fn();
  const context = {
    tabs,
    activeTabId,
    crypto,
    PANE_COUNTS: { "2-way": 2, "4-way": 4 },
    defaultSizes: () => ({ rowSizes: [100], rowColSizes: [[50, 50]] }),
    assignTabsToSplit,
    createSplitConfig,
    setTabs: (update: (tabs: Tab[]) => Tab[]) => {
      tabs = update(tabs);
    },
    setActiveTabId,
    setSplitMode,
    setPaneTabIds: vi.fn(),
    setRowSizes: vi.fn(),
    setRowColSizes: vi.fn(),
    changeSplitMode: vi.fn(),
    doCloseTab: vi.fn(),
  };
  const select = runInNewContext(`${code}\nselectSplitMode`, context) as (
    mode: SplitMode,
  ) => void;
  return { select, getTabs: () => tabs, setActiveTabId, setSplitMode };
}

it.each(["terminal-1", "dashboard"])(
  "selects a split layout without randomUUID from %s",
  (active) => {
    const state = shell({}, active);
    state.select("2-way");
    const tabs = state.getTabs();
    const split = tabs.find((tab) => tab.type === "split-screen")!;
    expect(split).toBeDefined();
    expect(split.instanceId).toBeTruthy();
    expect(split.splitConfig?.paneTabIds.slice(0, 2)).toEqual([
      "terminal-1",
      "terminal-2",
    ]);
    expect(tabs.find((tab) => tab.id === "terminal-1")?.parentSplitTabId).toBe(
      split.id,
    );
    expect(state.setActiveTabId).toHaveBeenCalledWith(split.id);
    expect(state.setSplitMode).toHaveBeenCalledWith("2-way");
  },
);

it("uses native UUIDs when available", () => {
  const randomUUID = vi.fn(() => "native-id");
  const state = shell({ randomUUID });
  state.select("2-way");
  expect(randomUUID).toHaveBeenCalledOnce();
  expect(
    state.getTabs().find((tab) => tab.type === "split-screen")?.instanceId,
  ).toBe("native-id");
});
