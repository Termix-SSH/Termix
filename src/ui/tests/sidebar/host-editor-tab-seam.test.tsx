import { afterEach, describe, expect, it } from "vitest";
import { Puzzle } from "lucide-react";
import {
  getRegisteredHostEditorTab,
  makeHostSshSubTabs,
  registerHostEditorTab,
  registeredHostEditorTabList,
  unregisterHostEditorTab,
} from "@/sidebar/HostManagerTabs";

const FAKE_TAB_ID = "__test_plugin_host_editor_tab__";

function FakeTabComponent() {
  return null;
}

describe("registerHostEditorTab seam", () => {
  afterEach(() => {
    unregisterHostEditorTab(FAKE_TAB_ID);
  });

  it("is not registered by default", () => {
    expect(getRegisteredHostEditorTab(FAKE_TAB_ID)).toBeUndefined();
    expect(registeredHostEditorTabList()).toEqual([]);
  });

  it("registers and unregisters a plugin host editor tab", () => {
    registerHostEditorTab({
      id: FAKE_TAB_ID,
      labelKey: "nav.fakePluginItem",
      icon: <Puzzle />,
      component: FakeTabComponent,
    });

    expect(getRegisteredHostEditorTab(FAKE_TAB_ID)?.component).toBe(
      FakeTabComponent,
    );
    expect(registeredHostEditorTabList().map((t) => t.id)).toContain(
      FAKE_TAB_ID,
    );

    unregisterHostEditorTab(FAKE_TAB_ID);

    expect(getRegisteredHostEditorTab(FAKE_TAB_ID)).toBeUndefined();
  });

  it("appends a registered tab after the built-in SSH sub-tabs", () => {
    registerHostEditorTab({
      id: FAKE_TAB_ID,
      labelKey: "nav.fakePluginItem",
      icon: <Puzzle />,
      component: FakeTabComponent,
    });

    const ids: string[] = makeHostSshSubTabs((key) => key).map((tab) => tab.id);
    expect(ids).toContain(FAKE_TAB_ID);
    expect(ids.indexOf(FAKE_TAB_ID)).toBe(ids.length - 1);
  });
});
