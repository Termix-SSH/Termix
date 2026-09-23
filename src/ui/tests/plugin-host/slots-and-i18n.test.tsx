import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useTranslation, type TermixApp } from "@termix/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import { ComponentSlot } from "@/shell/ActionSlot";
import { resetActionRegistry } from "@/shell/action-registry";
import { resetPluginStore } from "@/plugin-host/plugin-store";
import { resetPanels } from "@/shell/panel-registry";
import { setPermissionsForTesting } from "@/hooks/use-permissions";
import i18n from "@/i18n/i18n";
import { pluginKey } from "@/lib/plugin-i18n";

const mounted: RenderedPluginApp[] = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.deactivate();
  resetActionRegistry();
  resetPanels();
  resetPluginStore();
});

function Label() {
  const { t } = useTranslation();
  return <span>{t("label")}</span>;
}

describe("component slots", () => {
  function contribute(permission?: string) {
    return async (app: TermixApp) => {
      if (permission) {
        app.registerAction("slotty.panel", () => {}, { permission });
      }
      app.registerSlotContribution("owner.slot", {
        actionId: "slotty.panel",
        titleKey: "label",
        kind: "component",
        component: ({ who }: Record<string, unknown>) => (
          <span>contributed for {String(who)}</span>
        ),
        when: (context) => context.show !== false,
      });
    };
  }

  const manifest = {
    id: "slotty",
    contributes: {
      permissions: [{ name: "use", titleKey: "l", descriptionKey: "l" }],
    },
  };

  it("renders nothing when nobody contributed", () => {
    setPermissionsForTesting([]);
    const { container } = render(<ComponentSlot slotId="owner.slot" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the user lacks the permission", async () => {
    mounted.push(
      await renderWithApp(
        { activate: contribute("use") },
        { manifest, permissions: [] },
      ),
    );
    const { container } = render(
      <ComponentSlot slotId="owner.slot" props={{ who: "me" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the contribution with the owner's props when permitted", async () => {
    mounted.push(
      await renderWithApp(
        { activate: contribute("use") },
        { manifest, permissions: ["slotty.use"] },
      ),
    );
    render(<ComponentSlot slotId="owner.slot" props={{ who: "me" }} />);
    expect(await screen.findByText("contributed for me")).toBeTruthy();
  });

  it("honours a contribution's when", async () => {
    mounted.push(await renderWithApp({ activate: contribute() }, { manifest }));
    const { container } = render(
      <ComponentSlot slotId="owner.slot" when={{ show: false }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("plugin translations", () => {
  it("keeps two plugins' identical keys apart", async () => {
    for (const [id, text] of [
      ["first", "From the first plugin"],
      ["second", "From the second plugin"],
    ] as const) {
      const app = await renderWithApp(
        {
          activate(app) {
            app.registerPanel(`${id}-panel`, Label);
          },
        },
        {
          manifest: {
            id,
            contributes: { panels: [{ id: `${id}-panel`, titleKey: "label" }] },
          },
          locales: { label: text },
        },
      );
      mounted.push(app);
    }
    const [first, second] = mounted;
    expect(first.renderPanel("first-panel").textContent).toBe(
      "From the first plugin",
    );
    expect(second.renderPanel("second-panel").textContent).toBe(
      "From the second plugin",
    );
  });

  it("falls back to core strings for keys the plugin does not define", async () => {
    mounted.push(
      await renderWithApp(
        {
          activate(app) {
            app.registerPanel("borrow-panel", () => {
              const { t } = useTranslation();
              return <span>{t("common.save")}</span>;
            });
          },
        },
        {
          manifest: {
            id: "borrow",
            contributes: { panels: [{ id: "borrow-panel", titleKey: "x" }] },
          },
          locales: {},
        },
      ),
    );
    expect(mounted[0].renderPanel("borrow-panel").textContent).toBe(
      i18n.t("common.save"),
    );
  });

  it("qualifies manifest keys with the plugin's namespace", () => {
    expect(pluginKey("tailscale", "settings.apiKey.label")).toBe(
      "tailscale:settings.apiKey.label",
    );
    expect(pluginKey("tailscale", "other:key")).toBe("other:key");
  });
});
