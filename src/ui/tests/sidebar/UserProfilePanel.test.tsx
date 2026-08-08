import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Panel-level dependencies that are irrelevant to AccordionSection but would
// otherwise be pulled in by importing the module.
vi.mock("@/settings/RemoteSyncPanel.tsx", () => ({
  RemoteSyncPanel: () => null,
}));
vi.mock("@/user/C2STunnelPresetManager", () => ({
  C2STunnelPresetManager: () => null,
}));
vi.mock("@/i18n/i18n", () => ({
  changeAppLanguage: vi.fn(),
  normalizeLanguageCode: (code: string) => code,
}));
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));
vi.mock("@/lib/electron", () => ({ isElectron: () => false }));

import { AccordionSection } from "../../sidebar/UserProfilePanel";

afterEach(cleanup);

function renderSection(hidden: boolean, open = false, onToggle = vi.fn()) {
  render(
    <AccordionSection
      id="security"
      label="Security"
      icon={<span data-testid="icon" />}
      open={open}
      onToggle={onToggle}
      hidden={hidden}
    >
      <button>Change password</button>
    </AccordionSection>,
  );
  return onToggle;
}

describe("AccordionSection", () => {
  it("renders its header when visible, and its content once expanded", () => {
    renderSection(false);
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.queryByText("Change password")).toBeNull();

    cleanup();
    renderSection(false, true);
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Change password")).toBeTruthy();
  });

  it("renders nothing at all when hidden, even expanded", () => {
    renderSection(true, true);

    expect(screen.queryByText("Security")).toBeNull();
    // The children must not reach the DOM either: on the desktop build this
    // section holds password and 2FA controls for an account that signs in
    // automatically and has no login password, so merely collapsing it would
    // still imply a protection that is not there.
    expect(screen.queryByText("Change password")).toBeNull();
  });

  it("is visible by default when hidden is not passed", () => {
    render(
      <AccordionSection
        id="account"
        label="Account"
        icon={<span />}
        open={false}
        onToggle={vi.fn()}
      >
        <span>body</span>
      </AccordionSection>,
    );

    expect(screen.getByText("Account")).toBeTruthy();
  });

  it("reports its expanded state and toggles on click", () => {
    const onToggle = renderSection(false, false);
    const header = screen.getByRole("button", { name: /Security/ });

    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.getAttribute("aria-controls")).toBe("security-content");

    fireEvent.click(header);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("cannot be toggled while hidden, since there is no header to click", () => {
    const onToggle = renderSection(true, false);

    expect(screen.queryByRole("button", { name: /Security/ })).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });
});
