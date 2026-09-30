import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionTree } from "../../src/frontend/SessionTree";
vi.mock("@termix/plugin-sdk/frontend", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
it("selects a session by its label while the chevron only changes expansion", () => {
  const select = vi.fn();
  const toggle = vi.fn();
  const noop = () => {};
  render(
    <SessionTree
      sessions={[
        {
          name: "same",
          created: 1,
          lastActivity: 1,
          attachedClients: 0,
          windows: [],
          tags: [],
        },
      ]}
      expandedSessions={new Set()}
      onToggleSession={toggle}
      selectedPaneId={null}
      onSelectPane={noop}
      metricsByPane={new Map()}
      metricsBySession={new Map()}
      onSelectSession={select}
      onEditTags={noop}
      onAttachSession={noop}
      onNewWindow={noop}
      onRenameSession={noop}
      onKillSession={noop}
      onKillPane={noop}
      onSplitPane={noop}
      onKillWindow={noop}
      compact={false}
      now={1}
    />,
  );
  fireEvent.click(screen.getByText("same"));
  expect(select).toHaveBeenCalledExactlyOnceWith("same");
  expect(toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("tmuxMonitor.toggleSession"));
  expect(toggle).toHaveBeenCalledExactlyOnceWith("same");
  expect(select).toHaveBeenCalledOnce();
});
