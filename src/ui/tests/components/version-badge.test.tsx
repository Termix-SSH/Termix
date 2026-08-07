import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { VersionBadge } from "../../components/version-badge";

afterEach(cleanup);

// `t` is mocked to the identity above, so every label below is the raw key.
const RELEASE_URL =
  "https://github.com/Termix-SSH/Termix/releases/tag/release-2.6.1-tag";
const LINK_LABEL = "versionCheck.updateLinkLabel";
const UPDATE_TEXT = "dashboard.updateAvailable".toUpperCase();

describe("VersionBadge", () => {
  it("links to the release when an update is available", () => {
    render(<VersionBadge status="requires_update" releaseUrl={RELEASE_URL} />);

    // Queried by its accessible name: the badge text alone ("UPDATE
    // AVAILABLE") never says where the link goes.
    const link = screen.getByRole("link", { name: LINK_LABEL });
    expect(link.getAttribute("href")).toBe(RELEASE_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("title")).toBe(LINK_LABEL);
    expect(link.textContent).toBe(UPDATE_TEXT);
  });

  it("keeps the yellow update treatment on the link", () => {
    render(<VersionBadge status="requires_update" releaseUrl={RELEASE_URL} />);

    const className = screen.getByRole("link").className;
    expect(className).toContain("bg-yellow-500/20");
    expect(className).toContain("text-yellow-400");
    expect(className).toContain("hover:underline");
  });

  it("stays an inert badge when the response carried no release URL", () => {
    // A dead anchor is worse than no anchor: it looks actionable and isn't.
    render(<VersionBadge status="requires_update" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(UPDATE_TEXT)).toBeTruthy();
  });

  it("stays inert when up to date, even if a release URL is known", () => {
    render(<VersionBadge status="up_to_date" releaseUrl={RELEASE_URL} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("dashboardTab.stable")).toBeTruthy();
  });

  it("stays inert on the beta channel, which the release page does not serve", () => {
    render(<VersionBadge status="beta" releaseUrl={RELEASE_URL} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("dashboard.beta".toUpperCase())).toBeTruthy();
  });

  // The dashboard's stats bar sits in a flex column, so its badge needs
  // `w-fit` to stop the background stretching the full column width. The
  // profile panel's badge does not. Both must come out of one component.
  it("appends the caller's className without dropping the status classes", () => {
    render(
      <VersionBadge
        status="requires_update"
        releaseUrl={RELEASE_URL}
        className="w-fit"
      />,
    );

    const className = screen.getByRole("link").className;
    expect(className).toContain("w-fit");
    expect(className).toContain("bg-yellow-500/20");
  });

  it("applies the className on the inert span too", () => {
    render(<VersionBadge status="up_to_date" className="w-fit" />);

    const badge = screen.getByText("dashboardTab.stable");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.className).toContain("w-fit");
    expect(badge.className).toContain("bg-accent-brand/20");
  });

  it("emits no stray whitespace class when no className is passed", () => {
    render(<VersionBadge status="up_to_date" />);

    const badge = screen.getByText("dashboardTab.stable");
    expect(badge.className).toBe(badge.className.trim());
  });
});
