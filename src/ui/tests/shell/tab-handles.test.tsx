import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { Share2 } from "lucide-react";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/electron", () => ({ isElectron: () => true }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    permissions: [],
    isAdmin: false,
    loaded: true,
    has: () => true,
  }),
}));

import { trackTabHandle, useTabHandlesVersion } from "@/shell/tab-handles";
import { TabBar } from "@/shell/TabBar";
import {
  declareActionSlot,
  registerAction,
  registerSlotContribution,
  resetActionRegistry,
} from "@/shell/action-registry";

afterEach(() => {
  cleanup();
  resetActionRegistry();
});

describe("trackTabHandle", () => {
  it("passes no ref through", () => {
    expect(trackTabHandle(undefined)).toBeUndefined();
  });

  it("returns one callback per ref that fills it and bumps the version", () => {
    const ref = createRef<unknown>();
    const callback = trackTabHandle(ref) as (value: unknown) => void;
    expect(trackTabHandle(ref)).toBe(callback);

    const { result } = renderHook(() => useTabHandlesVersion());
    const before = result.current;
    const handle = { disconnect: () => {} };
    act(() => callback(handle));
    expect(ref.current).toBe(handle);
    expect(result.current).toBe(before + 1);

    act(() => callback(handle));
    expect(result.current).toBe(before + 1);

    act(() => callback(null));
    expect(ref.current).toBeNull();
    expect(result.current).toBe(before + 2);
  });
});

describe("tab inline buttons", () => {
  it("show as soon as the tab's handle attaches", () => {
    declareActionSlot({ id: "tab.inline", accepts: ["button"] });
    registerAction("test.share", () => {});
    registerSlotContribution("tab.inline", {
      actionId: "test.share",
      titleKey: "share",
      icon: Share2,
      when: (context) =>
        typeof (context.handle as { getShareTarget?: unknown } | undefined)
          ?.getShareTarget === "function",
    });
    const terminalRef = createRef<unknown>();
    const tabs = [
      { id: "terminal-1", type: "terminal", label: "web-01", terminalRef },
    ] as unknown as Tab[];

    render(
      <TabBar
        tabs={tabs}
        activeTabId="terminal-1"
        splits={[]}
        activeSplitFull={false}
        onSetActiveTab={() => {}}
        onCloseTab={() => {}}
        onRefreshTab={() => {}}
        onReorderTabs={() => {}}
        onSplitAction={() => {}}
        isAppFullscreen={false}
        onToggleAppFullscreen={() => {}}
      />,
    );
    expect(screen.queryByTitle("share")).toBeNull();

    const attach = trackTabHandle(terminalRef) as (value: unknown) => void;
    act(() => attach({ getShareTarget: () => null }));
    expect(screen.getByTitle("share")).toBeInTheDocument();
  });
});
