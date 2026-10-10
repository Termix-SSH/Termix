import { afterEach, describe, expect, it } from "vitest";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import { resetActionRegistry } from "@/shell/action-registry";
import { resetPluginStore } from "@/plugin-host/plugin-store";
import {
  onboardingSteps,
  SECTION_POSITION,
} from "@/onboarding/onboarding-registry";
import { pluginKey } from "@/lib/plugin-i18n";

const mounted: RenderedPluginApp[] = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.deactivate();
  resetActionRegistry();
  resetPluginStore();
  onboardingSteps.reset();
});

const Step = () => <span>step</span>;

async function mount(activate: (app: TermixApp) => void) {
  const rendered = await renderWithApp(
    { activate: async (app: TermixApp) => activate(app) },
    { manifest: { id: "guac" } },
  );
  mounted.push(rendered);
  return rendered;
}

describe("app.registerOnboardingStep", () => {
  it("keys the step by plugin, namespaces its text and places it by section", async () => {
    await mount((app) => {
      app.registerOnboardingStep({
        id: "setup",
        version: 2,
        titleKey: "onboarding.title",
        descriptionKey: "onboarding.desc",
        component: Step,
        audience: "admin",
        section: "setup",
        permission: "manage",
      });
    });
    const [step] = onboardingSteps.list();
    expect(step).toMatchObject({
      id: "guac:setup",
      pluginId: "guac",
      version: 2,
      audience: "admin",
      titleKey: pluginKey("guac", "onboarding.title"),
      descriptionKey: pluginKey("guac", "onboarding.desc"),
      permission: "guac.manage",
    });
    expect(Math.floor(step.position)).toBe(SECTION_POSITION.setup);
  });

  it("defaults to version 1, everyone, and the explore section", async () => {
    await mount((app) => {
      app.registerOnboardingStep({
        id: "tour",
        titleKey: "t",
        component: Step,
      });
    });
    const [step] = onboardingSteps.list();
    expect(step.version).toBe(1);
    expect(step.audience).toBe("all");
    expect(Math.round(step.position)).toBe(SECTION_POSITION.explore);
  });

  it("passes only the documented context to when, and survives it throwing", async () => {
    let seen: unknown;
    await mount((app) => {
      app.registerOnboardingStep({
        id: "a",
        titleKey: "t",
        component: Step,
        when: (context) => {
          seen = context;
          return context.isDesktop;
        },
      });
      app.registerOnboardingStep({
        id: "b",
        titleKey: "t",
        component: Step,
        when: () => {
          throw new Error("boom");
        },
      });
    });
    const ctx = {
      mode: "full" as const,
      isAdmin: true,
      isDesktop: true,
      has: () => true,
      pluginSetupPending: true,
      pluginsManagedElsewhere: false,
    };
    const [a, b] = onboardingSteps.list();
    expect(a.isRelevant?.(ctx)).toBe(true);
    expect(seen).toEqual({ isAdmin: true, isDesktop: true, mode: "full" });
    expect(b.isRelevant?.(ctx)).toBe(false);
  });

  it("refuses a bad id or version", async () => {
    await expect(
      mount((app) => {
        app.registerOnboardingStep({
          id: "Bad Id",
          titleKey: "t",
          component: Step,
        });
      }),
    ).rejects.toThrow(/not valid/);
    await expect(
      mount((app) => {
        app.registerOnboardingStep({
          id: "ok",
          version: 0,
          titleKey: "t",
          component: Step,
        });
      }),
    ).rejects.toThrow(/version/);
  });

  it("removes everything when the plugin is turned off", async () => {
    const rendered = await mount((app) => {
      app.registerOnboardingStep({ id: "s", titleKey: "t", component: Step });
    });
    expect(onboardingSteps.list()).toHaveLength(1);

    mounted.splice(mounted.indexOf(rendered), 1);
    await rendered.deactivate();
    expect(onboardingSteps.list()).toEqual([]);
  });
});

describe("renderWithApp onboarding helpers", () => {
  it("lists and renders a plugin's onboarding step", async () => {
    const rendered = await mount((app) => {
      app.registerOnboardingStep({
        id: "check",
        titleKey: "t",
        component: ({ setCanContinue, setBeforeNext }) => {
          setCanContinue(false);
          setBeforeNext(() => false);
          return <span>checking</span>;
        },
      });
    });
    expect(rendered.registered.onboardingSteps()).toEqual(["check"]);
    const step = rendered.renderOnboardingStep("check");
    expect(step.element.textContent).toContain("checking");
    expect(step.canContinue()).toBe(false);
    expect(await step.next()).toBe(false);
  });
});
