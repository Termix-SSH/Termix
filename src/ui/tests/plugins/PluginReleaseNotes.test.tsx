import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import type { PluginEntry } from "@/plugins/plugin-model";

const getPluginChangelog = vi.hoisted(() => vi.fn());
vi.mock("@/api/plugins-api", () => ({ getPluginChangelog }));

const { PluginReleaseNotes, PluginVideo } =
  await import("@/plugins/PluginReleaseNotes");

afterEach(() => {
  cleanup();
  getPluginChangelog.mockReset();
});

async function i18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "en",
    resources: {
      en: {
        translation: {
          plugins: {
            manager: {
              releaseNotes: "Release notes",
              installedBadge: "Installed",
              changeTypes: { added: "Added", fixed: "Fixed" },
              videoTitle: "{{name}} video",
            },
          },
        },
      },
    },
  });
  return instance;
}

function plugin(overrides: Partial<PluginEntry> = {}): PluginEntry {
  return {
    id: "docker",
    name: "Docker",
    installed: true,
    version: "1.0.0",
    versions: [],
    ...overrides,
  } as PluginEntry;
}

describe("PluginReleaseNotes", () => {
  it("shows the installed copy's changelog grouped by type", async () => {
    getPluginChangelog.mockResolvedValue([
      {
        version: "1.0.0",
        changes: [
          { type: "added", text: "Runs `docker ps`" },
          { type: "fixed", text: "A crash" },
        ],
      },
    ]);
    render(
      <I18nextProvider i18n={await i18n()}>
        <PluginReleaseNotes plugin={plugin()} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.getByText("A crash")).toBeTruthy());
    expect(getPluginChangelog).toHaveBeenCalledWith("docker");
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("docker ps").tagName).toBe("CODE");
    expect(screen.getByText("Installed")).toBeTruthy();
  });

  it("renders nothing for a plugin with no versions", async () => {
    const { container } = render(
      <I18nextProvider i18n={await i18n()}>
        <PluginReleaseNotes plugin={plugin({ installed: false })} />
      </I18nextProvider>,
    );
    expect(container.innerHTML).toBe("");
    expect(getPluginChangelog).not.toHaveBeenCalled();
  });
});

describe("PluginVideo", () => {
  it("embeds a YouTube id", async () => {
    render(
      <I18nextProvider i18n={await i18n()}>
        <PluginVideo videoId="dQw4w9WgXcQ" name="Docker" />
      </I18nextProvider>,
    );
    const frame = screen.getByTitle("Docker video") as HTMLIFrameElement;
    expect(frame.src).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });

  it("loads nothing without a valid id", async () => {
    const { container } = render(
      <I18nextProvider i18n={await i18n()}>
        <PluginVideo videoId="https://evil.example" name="Docker" />
        <PluginVideo name="Docker" />
      </I18nextProvider>,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });
});
