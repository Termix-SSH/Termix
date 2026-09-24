import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TouchInputSettings } from "../../../src/frontend/settings/TouchInputSettings";
import { TOUCH_INPUT_DEFAULTS } from "../../../src/shared/touch-input-settings";

function renderSettings(values: Record<string, unknown> = {}) {
  const setValue = vi.fn();
  render(
    <TouchInputSettings
      pluginId="ssh-terminal"
      values={values}
      setValue={setValue}
      running
    />,
  );
  return setValue;
}

describe("TouchInputSettings", () => {
  it("shows simple defaults, keeps tunables collapsed, and resets", async () => {
    const user = userEvent.setup();
    const setValue = renderSettings({
      touchInput: { ...TOUCH_INPUT_DEFAULTS, dragThresholdPx: 20 },
    });

    expect(screen.getByText("touchInput.enabled")).toBeTruthy();
    expect(screen.queryByLabelText("touchInput.dragThreshold")).toBeNull();
    await user.click(screen.getByText("touchInput.advanced"));
    expect(
      (screen.getByLabelText("touchInput.dragThreshold") as HTMLInputElement)
        .value,
    ).toBe("20");
    expect(
      (
        screen.getByLabelText(
          "touchInput.maximumTicksPerFrame",
        ) as HTMLInputElement
      ).value,
    ).toBe("4");

    await user.click(screen.getByText("touchInput.resetDefaults"));
    expect(setValue).toHaveBeenLastCalledWith("touchInput", {
      ...TOUCH_INPUT_DEFAULTS,
    });
  });

  it("falls back to the defaults when nothing is stored", () => {
    renderSettings();
    expect(screen.getByText("touchInput.momentumEnabled")).toBeTruthy();
  });
});
