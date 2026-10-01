import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  HostDefaultBadge,
  HostDefaultsContext,
  HostOnly,
  type HostDefaultsContextValue,
} from "@/lib/host-defaults-context";
import { SettingRow } from "@/components/section-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

function context(
  partial: Partial<HostDefaultsContextValue> = {},
): HostDefaultsContextValue {
  return {
    mode: "host",
    isOwn: () => false,
    source: () => ({ level: "user" }),
    reset: vi.fn(),
    isAvailable: () => true,
    ...partial,
  };
}

function withContext(value: HostDefaultsContextValue, ui: React.ReactNode) {
  return render(
    <HostDefaultsContext.Provider value={value}>
      {ui}
    </HostDefaultsContext.Provider>,
  );
}

describe("HostDefaultBadge", () => {
  it("renders nothing outside the host editor", () => {
    const { container } = render(
      <HostDefaultBadge settingKey="core.sshPort" />,
    );
    expect(container.textContent).toBe("");
  });

  it("says where an inherited value comes from", () => {
    withContext(
      context({
        source: () => ({ level: "folder", folderName: "Prod" }),
      }),
      <HostDefaultBadge settingKey="core.sshPort" />,
    );
    expect(screen.getByText("hostDefaults.source.folder:Prod")).toBeTruthy();
  });

  it("shows nothing for a value that follows the built-in default", () => {
    const { container } = withContext(
      context({ source: () => ({ level: "builtin" }) }),
      <HostDefaultBadge settingKey="core.sshPort" />,
    );
    expect(container.textContent).toBe("");
  });

  it("offers a reset for a host's own value", () => {
    const value = context({ isOwn: () => true });
    withContext(value, <HostDefaultBadge settingKey="core.sshPort" />);
    fireEvent.click(screen.getByText("hostDefaults.custom"));
    expect(value.reset).toHaveBeenCalledWith("core.sshPort");
  });

  it("offers a clear for a value set at the level being edited", () => {
    withContext(
      context({ mode: "defaults", isOwn: () => true, source: () => undefined }),
      <HostDefaultBadge settingKey="core.sshPort" />,
    );
    expect(screen.getByText("hostDefaults.setHere")).toBeTruthy();
  });

  it("says when nothing is set", () => {
    withContext(
      context({ source: () => undefined }),
      <HostDefaultBadge settingKey="core.username" />,
    );
    expect(screen.getByText("hostDefaults.notSet")).toBeTruthy();
  });
});

describe("in the defaults editor", () => {
  it("hides a row whose key cannot be a default at this level", () => {
    withContext(
      context({ mode: "defaults", isAvailable: () => false }),
      <SettingRow label="Jump hosts" defaultKey="core.jumpHosts">
        <span />
      </SettingRow>,
    );
    expect(screen.queryByText("Jump hosts")).toBeNull();
  });

  it("hides what only one host can have", () => {
    withContext(
      context({ mode: "defaults" }),
      <HostOnly>
        <span>Address</span>
      </HostOnly>,
    );
    expect(screen.queryByText("Address")).toBeNull();
  });
});
