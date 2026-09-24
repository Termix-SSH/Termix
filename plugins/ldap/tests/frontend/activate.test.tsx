import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe(`${manifest.id} activate`, () => {
  it("registers the login form and the directory settings", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.loginMethods()).toEqual(["ldap"]);
    expect(rendered.registered.settingsComponents()).toEqual(["providers"]);
  });

  it("submits the username and password for the chosen directory", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const submit = vi.fn(async () => {});
    rendered.renderLoginMethod("ldap", {
      instances: [{ id: "4", label: "Corp" }],
      submit,
    });
    fireEvent.click(screen.getByText("Login with Corp"));
    fireEvent.change(screen.getByLabelText(locales.username), {
      target: { value: " bob " },
    });
    fireEvent.change(screen.getByLabelText(locales.password), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByText(locales.signIn));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        { username: "bob", password: "hunter2" },
        "4",
      ),
    );
  });

  it("does not submit an empty form", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const submit = vi.fn(async () => {});
    rendered.renderLoginMethod("ldap", {
      instances: [{ id: "4", label: "Corp" }],
      submit,
    });
    fireEvent.click(screen.getByText("Login with Corp"));
    fireEvent.click(screen.getByText(locales.signIn));
    expect(submit).not.toHaveBeenCalled();
  });

  it("lists directories without their bind password", async () => {
    const get = vi.fn(async () => ({
      data: {
        providers: [
          {
            id: 4,
            name: "Corp LDAP",
            enabled: true,
            displayOrder: 0,
            config: { host: "ldap.example" },
            hasBindPassword: true,
          },
        ],
      },
    }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get } as never,
    });
    rendered.renderSettingsComponent("providers");
    expect(await screen.findByText("Corp LDAP")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/providers");
  });

  it("removes everything on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.loginMethods()).toEqual([]);
  });
});
