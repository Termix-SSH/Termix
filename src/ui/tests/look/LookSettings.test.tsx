import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const look = vi.hoisted(() => ({
  chooseLayout: vi.fn(async () => {}),
  chooseDefaultLook: vi.fn(async () => {}),
  state: {
    loaded: true,
    response: {
      layoutId: null as string | null,
      themeId: null,
      defaults: { layout: null, theme: null },
      defaultLook: { layout: null, theme: null },
      safeLayout: false,
      unavailable: [],
    },
  },
}));
vi.mock("@/look/look-store", () => ({
  chooseLayout: look.chooseLayout,
  chooseDefaultLook: look.chooseDefaultLook,
  useLookState: () => look.state,
}));

import { LookSettings } from "@/look/LookSettings";
import { resetPluginLayouts, setPluginLayouts } from "@/look/layout-registry";

beforeEach(() => {
  look.chooseLayout.mockClear();
  look.chooseDefaultLook.mockClear();
  setPluginLayouts([{ id: "fancy", label: "Fancy", pluginId: "fancy-layout" }]);
});
afterEach(() => {
  cleanup();
  resetPluginLayouts();
});

describe("LookSettings", () => {
  it("lists every layout and saves the user's pick", () => {
    render(<LookSettings isAdmin={false} />);
    const select = screen.getAllByRole("combobox")[0];
    expect(screen.getAllByText("Fancy").length).toBeGreaterThan(0);
    fireEvent.change(select, { target: { value: "fancy" } });
    expect(look.chooseLayout).toHaveBeenCalledWith("fancy");
    fireEvent.change(select, { target: { value: "" } });
    expect(look.chooseLayout).toHaveBeenCalledWith(null);
    expect(screen.queryByText("looks.defaultsLabel")).toBeNull();
  });

  it("lets an admin set the default layout and theme", () => {
    render(<LookSettings isAdmin />);
    expect(screen.getByText("looks.defaultsLabel")).toBeTruthy();
    const [, layoutDefault, themeDefault] = screen.getAllByRole("combobox");
    fireEvent.change(layoutDefault, { target: { value: "fancy" } });
    expect(look.chooseDefaultLook).toHaveBeenCalledWith({ layout: "fancy" });
    fireEvent.change(themeDefault, { target: { value: "light" } });
    expect(look.chooseDefaultLook).toHaveBeenCalledWith({ theme: "light" });
  });
});
