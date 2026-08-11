import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTouchInputSection } from "../../sidebar/AdminTouchInputSection";
import { TOUCH_INPUT_DEFAULTS } from "@/types/touch-input-settings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("AdminTouchInputSection", () => {
  it("shows simple defaults, keeps tunables collapsed, and resets", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <AdminTouchInputSection
        open
        onToggle={vi.fn()}
        settings={{ ...TOUCH_INPUT_DEFAULTS }}
        setSettings={vi.fn()}
        onSave={vi.fn()}
        onReset={onReset}
      />,
    );

    expect(screen.getByText("admin.touchEnabled")).toBeTruthy();
    expect(screen.queryByLabelText("admin.touchDragThreshold")).toBeNull();
    await user.click(screen.getByText("admin.touchAdvanced"));
    expect(
      (screen.getByLabelText("admin.touchDragThreshold") as HTMLInputElement)
        .value,
    ).toBe("6");
    expect(
      (
        screen.getByLabelText(
          "admin.touchMaximumTicksPerFrame",
        ) as HTMLInputElement
      ).value,
    ).toBe("4");
    await user.click(screen.getByText("admin.touchResetDefaults"));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
