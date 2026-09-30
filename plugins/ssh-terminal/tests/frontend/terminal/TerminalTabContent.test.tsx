import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TabProps } from "@termix/plugin-sdk/frontend";

const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock("../../../src/frontend/terminal/Terminal", () => ({
  Terminal: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return null;
  },
}));

vi.mock(
  "../../../src/frontend/terminal/command-history/CommandHistoryContext",
  () => ({
    CommandHistoryProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
  }),
);

vi.mock("@termix/plugin-sdk/ui", () => ({
  useIsMobile: () => false,
}));

import { TerminalTabContent } from "../../../src/frontend/terminal/TerminalTabContent";

afterEach(() => {
  cleanup();
  captured.props = [];
});

function renderTab(inSplit?: boolean) {
  const props = {
    tab: { id: "t1", instanceId: "i1", type: "terminal", label: "web-01" },
    host: { id: "1", name: "web-01", ip: "10.0.0.1", port: 22 },
    sshHost: { id: 1 },
    label: "web-01",
    isVisible: true,
    isFocusedPane: true,
    inSplit,
    handleRef: null,
    shell: {
      closeTab: vi.fn(),
      renameTab: vi.fn(),
      openTab: vi.fn(),
    },
  } as unknown as TabProps;
  render(<TerminalTabContent {...props} />);
}

describe("TerminalTabContent in a split", () => {
  it("tells the terminal it is in a split, so it does not grab focus", async () => {
    renderTab(true);
    await waitFor(() => expect(captured.props.length).toBeGreaterThan(0));
    expect(captured.props.at(-1)?.splitScreen).toBe(true);
  });

  it("lets a terminal on its own take focus as before", async () => {
    renderTab(undefined);
    await waitFor(() => expect(captured.props.length).toBeGreaterThan(0));
    expect(captured.props.at(-1)?.splitScreen).toBe(false);
  });
});
