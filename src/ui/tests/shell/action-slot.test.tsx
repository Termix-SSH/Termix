/**
 * The three states a permission-gated slot contribution can be in, plus the
 * reactivity that makes a slot different from the rail/tab registries.
 *
 * Follows the pattern of sidebar/plugin-extension-seam.test.tsx: register into
 * the real registry, assert through a real render, then clean up. The point is
 * that states (a) "nothing contributed" and (b) "contributed but not
 * permitted" are indistinguishable in the DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Bot } from "lucide-react";

const perms = vi.hoisted(() => ({
  permissions: [] as string[],
  isAdmin: false,
  loaded: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-permissions", async () => {
  const { matchesPermission } = await import("@/lib/permissions");
  return {
    usePermissions: () => ({
      permissions: perms.permissions,
      isAdmin: perms.isAdmin,
      loaded: perms.loaded,
      has: (permission: string) =>
        matchesPermission(perms.permissions, perms.isAdmin, permission),
    }),
  };
});

import { ActionSlot } from "@/shell/ActionSlot";
import {
  declareActionSlot,
  registerAction,
  registerSlotContribution,
  resetActionRegistry,
  getSlotContributions,
  unregisterSlotContribution,
} from "@/shell/action-registry";

const SLOT = "terminal.toolbar";
const ACTION = "ai.openWithContext";

function contributeAi(handler = vi.fn()) {
  registerAction(ACTION, handler, { permission: "ai.services.use" });
  registerSlotContribution(SLOT, {
    actionId: ACTION,
    titleKey: "ai.assistant",
    icon: Bot,
  });
  return handler;
}

describe("ActionSlot", () => {
  beforeEach(() => {
    perms.permissions = [];
    perms.isAdmin = false;
    perms.loaded = true;
    declareActionSlot({ id: SLOT, accepts: ["button"] });
  });

  afterEach(() => {
    resetActionRegistry();
  });

  it("renders nothing when no plugin has contributed", () => {
    const { container } = render(<ActionSlot slotId={SLOT} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when the user lacks the permission", () => {
    const handler = contributeAi();

    const { container } = render(<ActionSlot slotId={SLOT} />);

    // Identical to the no-contribution case: no placeholder, and nothing
    // merely disabled or greyed out that hints at a feature out of reach.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("ai.assistant")).toBeNull();
    expect(container.querySelector("[disabled]")).toBeNull();
    expect(container.querySelector("[aria-disabled]")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders the button and invokes the action when permitted", async () => {
    const handler = contributeAi();
    perms.permissions = ["ai.services.use"];

    render(<ActionSlot slotId={SLOT} context={() => ["buffer text"]} />);

    const button = screen.getByRole("button", { name: "ai.assistant" });
    await act(async () => {
      button.click();
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("buffer text");
  });

  it("reads its context at click time, not on render", async () => {
    const handler = contributeAi();
    perms.permissions = ["ai.services.use"];
    const context = vi.fn(() => ["later"]);

    render(<ActionSlot slotId={SLOT} context={context} />);
    expect(context).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByRole("button", { name: "ai.assistant" }).click();
    });
    expect(context).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("later");
  });

  it("appears when a contribution is registered after mount", () => {
    perms.permissions = ["ai.services.use"];

    render(<ActionSlot slotId={SLOT} />);
    expect(screen.queryByRole("button")).toBeNull();

    // No re-render from the test: useSyncExternalStore has to do this. A
    // plain Map like the rail/tab registries would fail here.
    act(() => {
      contributeAi();
    });

    expect(screen.getByRole("button", { name: "ai.assistant" })).toBeTruthy();
  });

  it("disappears again when the contribution is removed", () => {
    contributeAi();
    perms.permissions = ["ai.services.use"];

    render(<ActionSlot slotId={SLOT} />);
    expect(screen.getByRole("button", { name: "ai.assistant" })).toBeTruthy();

    act(() => {
      unregisterSlotContribution(SLOT, ACTION);
    });

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a wildcard-granted contribution", () => {
    contributeAi();
    perms.permissions = ["ai.*"];

    render(<ActionSlot slotId={SLOT} />);

    expect(screen.getByRole("button", { name: "ai.assistant" })).toBeTruthy();
  });

  it("renders for an admin with no explicit grants", () => {
    contributeAi();
    perms.isAdmin = true;

    render(<ActionSlot slotId={SLOT} />);

    expect(screen.getByRole("button", { name: "ai.assistant" })).toBeTruthy();
  });

  it("renders an ungated contribution for everyone", () => {
    registerAction("demo.ping", vi.fn());
    registerSlotContribution(SLOT, {
      actionId: "demo.ping",
      titleKey: "demo.ping",
    });

    render(<ActionSlot slotId={SLOT} />);

    expect(screen.getByRole("button", { name: "demo.ping" })).toBeTruthy();
  });

  it("renders nothing while permissions are still loading", () => {
    contributeAi();
    perms.permissions = ["ai.services.use"];
    perms.loaded = false;

    const { container } = render(<ActionSlot slotId={SLOT} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the owner disables the slot", () => {
    contributeAi();
    perms.permissions = ["ai.services.use"];

    const { container } = render(<ActionSlot slotId={SLOT} enabled={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lets the slot owner render contributions its own way", () => {
    contributeAi();
    perms.permissions = ["ai.services.use"];

    render(
      <ActionSlot
        slotId={SLOT}
        renderItem={(contribution, invoke) => (
          <span data-testid="custom" onClick={invoke}>
            {contribution.titleKey}
          </span>
        )}
      />,
    );

    expect(screen.getByTestId("custom")).toHaveTextContent("ai.assistant");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("action registry", () => {
  afterEach(() => {
    resetActionRegistry();
  });

  it("refuses a contribution whose kind the slot does not accept", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    declareActionSlot({ id: SLOT, accepts: ["button"] });

    registerSlotContribution(SLOT, {
      actionId: "demo.menu",
      titleKey: "demo.menu",
      kind: "menu-item",
    });

    expect(getSlotContributions(SLOT)).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a contribution registered before its slot is declared", () => {
    registerSlotContribution(SLOT, {
      actionId: ACTION,
      titleKey: "ai.assistant",
    });

    expect(getSlotContributions(SLOT)).toHaveLength(1);

    declareActionSlot({ id: SLOT, accepts: ["button"] });
    expect(getSlotContributions(SLOT)).toHaveLength(1);
  });

  it("returns a stable snapshot reference between mutations", () => {
    declareActionSlot({ id: SLOT, accepts: ["button"] });
    registerSlotContribution(SLOT, {
      actionId: ACTION,
      titleKey: "ai.assistant",
    });

    // The guard against useSyncExternalStore's infinite re-render loop.
    expect(getSlotContributions(SLOT)).toBe(getSlotContributions(SLOT));

    const before = getSlotContributions(SLOT);
    registerSlotContribution(SLOT, {
      actionId: "demo.other",
      titleKey: "demo.other",
    });
    expect(getSlotContributions(SLOT)).not.toBe(before);
  });

  it("sorts by order then action id", () => {
    declareActionSlot({ id: SLOT, accepts: ["button"] });
    registerSlotContribution(SLOT, { actionId: "z.last", titleKey: "k" });
    registerSlotContribution(SLOT, { actionId: "a.first", titleKey: "k" });
    registerSlotContribution(SLOT, {
      actionId: "m.leading",
      titleKey: "k",
      order: -1,
    });

    expect(getSlotContributions(SLOT).map((c) => c.actionId)).toEqual([
      "m.leading",
      "a.first",
      "z.last",
    ]);
  });

  it("resolves quietly when a contribution points at a missing action", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { invokeAction } = await import("@/shell/action-registry");

    await expect(invokeAction("nobody.home")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
