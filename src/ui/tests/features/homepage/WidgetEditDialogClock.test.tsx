import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { WidgetEditDialog } from "../../../features/homepage/dialogs/WidgetEditDialog";
import type { CanvasWidget } from "@/types/homepage-types";

function clockWidget(timezone?: string): CanvasWidget {
  return {
    id: 7,
    typeId: "clock",
    title: "Clock",
    config: { timezone, showSeconds: true, format: "24h" },
    x: 0,
    y: 0,
    w: 8,
    h: 5,
    zOrder: 0,
  };
}

function open(timezone?: string) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <WidgetEditDialog
      widget={clockWidget(timezone)}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return {
    onSave,
    onClose,
    input: screen.getByPlaceholderText(/America\/New_York/) as HTMLInputElement,
    save: screen
      .getByText("homepage.save")
      .closest("button") as HTMLButtonElement,
  };
}

afterEach(cleanup);

describe("WidgetEditDialog clock timezone validation", () => {
  it("stores the normalized zone when the user typed a space", () => {
    const { onSave, onClose, input, save } = open();
    fireEvent.change(input, { target: { value: "America/New York" } });
    expect(screen.queryByText("homepage.invalidTimezone")).toBeNull();
    expect(save.disabled).toBe(false);

    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledWith(
      7,
      "Clock",
      expect.objectContaining({ timezone: "America/New_York" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("disables Save while the zone is unusable", () => {
    const { onSave, onClose, input, save } = open();
    fireEvent.change(input, { target: { value: "Not/AZone" } });

    expect(save.disabled).toBe(true);
    expect(screen.getByText("homepage.invalidTimezone")).toBeTruthy();

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-enables Save once the zone becomes usable", () => {
    const { onSave, input, save } = open();
    fireEvent.change(input, { target: { value: "Not/AZone" } });
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Asia/Tokyo" } });
    expect(save.disabled).toBe(false);
    expect(screen.queryByText("homepage.invalidTimezone")).toBeNull();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(
      7,
      "Clock",
      expect.objectContaining({ timezone: "Asia/Tokyo" }),
    );
  });

  it("saves a blank field as no timezone", () => {
    const { onSave, input, save } = open("Europe/Paris");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledWith(
      7,
      "Clock",
      expect.objectContaining({ timezone: undefined }),
    );
  });
});
