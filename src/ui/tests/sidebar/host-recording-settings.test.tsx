import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { createHostEditorForm } from "@/sidebar/HostEditorData";
import { HostPluginSections } from "@/settings/HostPluginSections";
import recording from "../../../../plugins/session-recording/manifest.json";
import sharing from "../../../../plugins/session-sharing/manifest.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

describe.each([
  { manifest: recording, key: "enableSessionRecording" },
  { manifest: sharing, key: "allowSessionSharing" },
])("$key after reopening a host", ({ manifest, key }) => {
  it.each([false, true])(
    "preserves the saved switch %s in the editor and its next change",
    (saved) => {
      const pluginSettings = {
        "session-recording": { enableSessionRecording: saved },
        "session-sharing": { allowSessionSharing: saved },
        "ssh-terminal": { enableCommandHistory: false },
      };
      const host = sshHostToHost({
        id: 1,
        name: "server",
        ip: "192.0.2.1",
        port: 22,
        username: "alice",
        folder: "",
        tags: [],
        pin: false,
        authType: "password",
        status: "online",
        createdAt: "2026-09-29T00:00:00Z",
        updatedAt: "2026-09-29T00:00:00Z",
        pluginSettings,
      });
      const form = createHostEditorForm(host);
      const setValue = vi.fn();
      render(
        <HostPluginSections
          plugins={[
            {
              ...manifest,
              enabled: true,
              state: "running",
            } as unknown as PluginSummary,
          ]}
          values={form.pluginSettings}
          setValue={setValue}
        />,
      );
      fireEvent.click(screen.getByRole("button"));
      expect(setValue).toHaveBeenCalledWith(manifest.id, key, !saved);
      // These are the values HostEditor writes through each plugin's host settings API.
      expect(form.pluginSettings).toEqual(pluginSettings);
    },
  );
});
