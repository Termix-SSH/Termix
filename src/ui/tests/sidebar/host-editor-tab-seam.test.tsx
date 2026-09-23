import { afterEach, describe, expect, it } from "vitest";
import { Puzzle } from "lucide-react";
import {
  getHostEditorSection,
  hostEditorSectionList,
  isSshGroupTab,
  makeHostSshSubTabs,
  makeHostTabs,
  registerHostEditorSection,
  resetHostEditorSections,
} from "@/sidebar/HostManagerTabs";

const FAKE_TAB_ID = "__test_plugin_host_editor_tab__";

function FakeTabComponent() {
  return null;
}

afterEach(() => resetHostEditorSections());

describe("host editor sections", () => {
  it("is not registered by default", () => {
    expect(getHostEditorSection(FAKE_TAB_ID)).toBeUndefined();
    expect(hostEditorSectionList()).toEqual([]);
  });

  it("registers and disposes a section", () => {
    const dispose = registerHostEditorSection({
      id: FAKE_TAB_ID,
      group: "ssh",
      labelKey: "nav.fakePluginItem",
      icon: Puzzle,
      component: FakeTabComponent,
    });
    expect(getHostEditorSection(FAKE_TAB_ID)?.component).toBe(FakeTabComponent);
    dispose();
    expect(getHostEditorSection(FAKE_TAB_ID)).toBeUndefined();
  });

  it("puts an SSH-group section in the second strip, by order", () => {
    registerHostEditorSection({
      id: FAKE_TAB_ID,
      group: "ssh",
      labelKey: "nav.fakePluginItem",
      order: 1000,
      component: FakeTabComponent,
    });
    const ids = makeHostSshSubTabs((key) => key).map((tab) => tab.id);
    expect(ids.at(-1)).toBe(FAKE_TAB_ID);
    // What made registered SSH-group tabs unreachable before: the editor
    // only recognised a fixed list of SSH-group ids.
    expect(isSshGroupTab(FAKE_TAB_ID)).toBe(true);
    expect(makeHostTabs((key) => key).map((tab) => tab.id)).not.toContain(
      FAKE_TAB_ID,
    );
  });

  it("shows a top-level section only for the protocols it asks for", () => {
    registerHostEditorSection({
      id: FAKE_TAB_ID,
      group: "top",
      labelKey: "nav.fakePluginItem",
      order: 20,
      visible: (protocols) => !!protocols.enableFake,
      component: FakeTabComponent,
    });
    const tabs = (protocols: Record<string, boolean>) =>
      makeHostTabs((key) => key, protocols).map((tab) => tab.id);
    expect(tabs({})).toEqual(["general", "ssh"]);
    expect(tabs({ enableFake: true })).toEqual(["general", "ssh", FAKE_TAB_ID]);
    expect(isSshGroupTab(FAKE_TAB_ID)).toBe(false);
  });

  it("treats a section whose visible throws as hidden", () => {
    registerHostEditorSection({
      id: FAKE_TAB_ID,
      group: "top",
      labelKey: "nav.fakePluginItem",
      visible: () => {
        throw new Error("broken plugin");
      },
      component: FakeTabComponent,
    });
    expect(makeHostTabs((key) => key, {}).map((tab) => tab.id)).not.toContain(
      FAKE_TAB_ID,
    );
  });
});
