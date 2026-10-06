import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

const prefsApi = vi.hoisted(() => ({
  getUserPreferences: vi.fn(),
  saveUserPreferences: vi.fn(async () => {}),
}));
vi.mock("@/api/open-tabs-api", () => prefsApi);

const theme = vi.hoisted(() => ({ value: "dark", setTheme: vi.fn() }));
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: theme.value, setTheme: theme.setTheme }),
}));

import {
  AccentPicker,
  isHexColor,
  ThemeGrid,
  THEMES,
  useAppearanceSettings,
} from "@/settings/appearance/appearance-controls";

beforeEach(() => {
  localStorage.clear();
  prefsApi.getUserPreferences.mockReset();
  prefsApi.saveUserPreferences.mockClear();
  theme.setTheme.mockClear();
});

describe("isHexColor", () => {
  it("accepts 3 and 6 digit hex only", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#f59145")).toBe(true);
    expect(isHexColor("f59145")).toBe(false);
    expect(isHexColor("#f5914")).toBe(false);
    expect(isHexColor("red")).toBe(false);
  });
});

describe("useAppearanceSettings", () => {
  it("saves to the account only in cloud mode", async () => {
    prefsApi.getUserPreferences.mockResolvedValue({ storageMode: "local" });
    const { result } = renderHook(() => useAppearanceSettings());
    await act(async () => {
      result.current.setAccent("#123456");
    });
    expect(localStorage.getItem("termix-accent")).toBe("#123456");
    expect(prefsApi.saveUserPreferences).not.toHaveBeenCalled();

    prefsApi.getUserPreferences.mockResolvedValue({ storageMode: "cloud" });
    await act(async () => {
      result.current.setTheme("nord");
      result.current.setFontSize("lg");
    });
    expect(theme.setTheme).toHaveBeenCalledWith("nord");
    expect(prefsApi.saveUserPreferences).toHaveBeenCalledWith({
      theme: "nord",
    });
    expect(prefsApi.saveUserPreferences).toHaveBeenCalledWith({
      fontSize: "lg",
    });
  });
});

describe("ThemeGrid", () => {
  it("offers every theme and reports the pick", () => {
    const onChange = vi.fn();
    render(<ThemeGrid value="dark" onChange={onChange} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(THEMES.length);
    fireEvent.click(buttons[THEMES.findIndex((t) => t.id === "gruvbox")]);
    expect(onChange).toHaveBeenCalledWith("gruvbox");
  });
});

describe("AccentPicker", () => {
  it("takes a typed hex on Enter and ignores anything else", () => {
    const onChange = vi.fn();
    render(<AccentPicker value="#f59145" onChange={onChange} />);
    const input = screen.getByPlaceholderText("#f97316");
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "#abcdef" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });
});
