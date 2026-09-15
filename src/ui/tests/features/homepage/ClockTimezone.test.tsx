import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ClockWidget } from "../../../features/homepage/widgets/ClockWidget";
import { ClockEditForm } from "../../../features/homepage/dialogs/ClockEditForm";
import {
  normalizeTimezone,
  validateClockTimezone,
} from "../../../features/homepage/clock-timezone";
import type { CanvasWidget, ClockConfig } from "@/types/homepage-types";

const widget: CanvasWidget = {
  id: 1,
  typeId: "clock",
  title: "Clock",
  config: {},
  x: 0,
  y: 0,
  w: 8,
  h: 5,
  zOrder: 0,
};

function renderClock(config: Partial<ClockConfig> = {}) {
  return render(
    <ClockWidget
      widget={widget}
      config={{ showSeconds: false, format: "24h", ...config }}
    />,
  );
}

function renderForm(config: Partial<ClockConfig> = {}) {
  const onChange = vi.fn();
  render(
    <ClockEditForm
      config={{ showSeconds: false, format: "24h", ...config }}
      onChange={onChange}
    />,
  );
  return {
    onChange,
    input: screen.getByPlaceholderText(/America\/New_York/) as HTMLInputElement,
  };
}

afterEach(cleanup);

describe("ClockWidget timezone handling", () => {
  it("renders instead of throwing when a saved config holds an invalid timezone", () => {
    // Regression: "America/New York" (space, not underscore) made
    // toLocaleTimeString throw a RangeError and took down the whole canvas.
    expect(() => renderClock({ timezone: "America/New York" })).not.toThrow();
    expect(screen.queryByText("America/New York")).toBeNull();
  });

  it("falls back to local time formatting for an invalid timezone", () => {
    renderClock({ timezone: "Not/AZone" });
    const local = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(screen.getByText(local)).toBeTruthy();
  });

  it("keeps and displays a valid timezone", () => {
    renderClock({ timezone: "America/New_York" });
    expect(screen.getByText("America/New_York")).toBeTruthy();
  });

  it("shows no timezone label when none is configured", () => {
    const { container } = renderClock();
    expect(
      container.querySelector('[class*="text-muted-foreground/60"]'),
    ).toBeNull();
  });

  it("formats in the configured timezone, not the host timezone", () => {
    renderClock({ timezone: "Asia/Tokyo" });
    const tokyo = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Tokyo",
    });
    expect(screen.getByText(tokyo)).toBeTruthy();
  });
});

describe("validateClockTimezone", () => {
  it("turns spaces into underscores", () => {
    expect(validateClockTimezone("America/New York")).toEqual({
      timezone: "America/New_York",
      valid: true,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateClockTimezone("  Europe/Paris  ")).toEqual({
      timezone: "Europe/Paris",
      valid: true,
    });
  });

  it("reports an unusable zone as invalid but still returns it normalized", () => {
    expect(validateClockTimezone("Not/AZone")).toEqual({
      timezone: "Not/AZone",
      valid: false,
    });
  });

  it("treats blank input as clearing the timezone", () => {
    expect(validateClockTimezone("   ")).toEqual({
      timezone: undefined,
      valid: true,
    });
    expect(validateClockTimezone(undefined)).toEqual({
      timezone: undefined,
      valid: true,
    });
  });

  it("normalizes every run of whitespace", () => {
    expect(normalizeTimezone("America/Argentina/Buenos  Aires")).toBe(
      "America/Argentina/Buenos_Aires",
    );
  });
});

describe("ClockEditForm", () => {
  it("stores what the user typed without rewriting it mid-edit", () => {
    const { onChange, input } = renderForm();
    fireEvent.change(input, { target: { value: "America/Los Angeles" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "America/Los Angeles" }),
    );
  });

  it("flags an unusable zone the same way FolderMetadataDialog flags a duplicate name", () => {
    const { input } = renderForm({ timezone: "Not/AZone" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("border-destructive");
    expect(screen.getByText("homepage.invalidTimezone")).toBeTruthy();
  });

  it("accepts a zone typed with a space, since it is normalized before checking", () => {
    const { input } = renderForm({ timezone: "America/New York" });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText("homepage.invalidTimezone")).toBeNull();
  });

  it("says nothing about an empty field", () => {
    const { input } = renderForm();
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText("homepage.invalidTimezone")).toBeNull();
  });

  it("clears the timezone when the field is emptied", () => {
    const { onChange, input } = renderForm({ timezone: "Europe/Paris" });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: undefined }),
    );
  });

  it("preserves the other clock settings when the timezone changes", () => {
    const { onChange, input } = renderForm({
      showSeconds: true,
      format: "12h",
    });
    fireEvent.change(input, { target: { value: "UTC" } });
    expect(onChange).toHaveBeenCalledWith({
      timezone: "UTC",
      showSeconds: true,
      format: "12h",
    });
  });
});
