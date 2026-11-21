import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useHostLinks } from "@/shell/controller/use-host-links";
import { resetDeepLinks } from "@/lib/deep-links";

afterEach(() => {
  resetDeepLinks();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

function setup(earlier: Array<{ url: string; source: string }>) {
  (window as { electronAPI?: unknown }).electronAPI = {
    onDeepLink: async () => earlier,
  };
  const connectHost = vi.fn();
  const confirm = vi.fn(async () => true);
  renderHook(() =>
    useHostLinks({
      hostsRef: { current: [{ id: 5, name: "web" }] },
      hostsLoaded: true,
      connectHost,
      confirmRef: { current: confirm },
    }),
  );
  return { connectHost, confirm };
}

describe("useHostLinks", () => {
  it("opens a --host shortcut without asking", async () => {
    const { connectHost, confirm } = setup([
      { url: "termix://host/5", source: "command-line" },
    ]);
    await waitFor(() => expect(connectHost).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before a link from anywhere else, and skips unknown hosts", async () => {
    const { connectHost, confirm } = setup([
      { url: "termix://host/9", source: "os-scheme" },
      { url: "termix://host/5", source: "os-scheme" },
    ]);
    await waitFor(() => expect(connectHost).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
