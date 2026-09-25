import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getUserSecondFactors: vi.fn(),
  resetUserSecondFactors: vi.fn(),
}));
vi.mock("@/api/auth-methods-api", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.plugin ? `${key}:${opts.plugin}` : key,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminSecondFactorsSection } from "@/sidebar/AdminSecondFactorsSection";

afterEach(() => vi.clearAllMocks());

describe("AdminSecondFactorsSection", () => {
  it("shows a factor whose plugin is off and resets after confirming", async () => {
    api.getUserSecondFactors.mockResolvedValue([
      {
        pluginId: "totp",
        factorId: "totp",
        labelKey: "factor",
        available: true,
      },
      { pluginId: "yubi", factorId: "otp", labelKey: null, available: false },
    ]);
    api.resetUserSecondFactors.mockResolvedValue(undefined);
    const onReset = vi.fn();
    const requestConfirm = vi.fn((_message: string, onConfirm: () => void) =>
      onConfirm(),
    );
    render(
      <AdminSecondFactorsSection
        userId="u1"
        username="alice"
        heading={<h2>factors</h2>}
        requestConfirm={requestConfirm}
        onReset={onReset}
      />,
    );
    expect(
      await screen.findByText("admin.secondFactorUnavailable"),
    ).toBeTruthy();
    // A plugin's label resolves in its own namespace.
    expect(screen.getByText("totp:factor")).toBeTruthy();
    fireEvent.click(screen.getByText("admin.resetSecondFactors"));
    expect(requestConfirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(api.resetUserSecondFactors).toHaveBeenCalledWith("u1"),
    );
    expect(onReset).toHaveBeenCalled();
  });
});
