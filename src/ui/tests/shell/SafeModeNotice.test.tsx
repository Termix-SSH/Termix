import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const toast = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const look = vi.hoisted(() => ({ safeMode: false }));
vi.mock("@/look/look-store", () => ({
  useLookState: () => ({
    loaded: true,
    response: { safeMode: look.safeMode },
  }),
}));

const { SafeModeNotice } = await import("@/shell/SafeModeNotice");

afterEach(() => {
  cleanup();
  toast.warning.mockReset();
});

describe("SafeModeNotice", () => {
  it("shows nothing when safe mode is off", () => {
    look.safeMode = false;
    render(<SafeModeNotice />);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("shows a lasting warning when the server runs in safe mode", () => {
    look.safeMode = true;
    render(<SafeModeNotice />);
    expect(toast.warning).toHaveBeenCalledWith(
      "safeMode.title",
      expect.objectContaining({
        id: "safe-mode",
        description: "safeMode.description",
        duration: Infinity,
      }),
    );
  });
});
