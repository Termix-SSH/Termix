import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTailscaleSection } from "../../../../../plugins/tailscale/frontend/AdminTailscaleSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("AdminTailscaleSection", () => {
  it("renders the API key and base URL fields and saves on click", async () => {
    const user = userEvent.setup();
    const handleSave = vi.fn();
    render(
      <AdminTailscaleSection
        open
        onToggle={vi.fn()}
        tailscaleApiKey="tskey-api-abc"
        setTailscaleApiKey={vi.fn()}
        tailscaleApiBaseUrl="https://api.tailscale.com/api/v2"
        setTailscaleApiBaseUrl={vi.fn()}
        handleSaveTailscaleApiKey={handleSave}
      />,
    );

    expect(
      (
        screen.getByPlaceholderText(
          "tskey-api-... / hskey-api-...",
        ) as HTMLInputElement
      ).value,
    ).toBe("tskey-api-abc");
    expect(
      (
        screen.getByPlaceholderText(
          "https://api.tailscale.com/api/v2",
        ) as HTMLInputElement
      ).value,
    ).toBe("https://api.tailscale.com/api/v2");

    await user.click(screen.getByText("common.save"));
    expect(handleSave).toHaveBeenCalledOnce();
  });

  it("does not render its content when closed", () => {
    render(
      <AdminTailscaleSection
        open={false}
        onToggle={vi.fn()}
        tailscaleApiKey=""
        setTailscaleApiKey={vi.fn()}
        tailscaleApiBaseUrl=""
        setTailscaleApiBaseUrl={vi.fn()}
        handleSaveTailscaleApiKey={vi.fn()}
      />,
    );

    expect(
      screen.queryByPlaceholderText("tskey-api-... / hskey-api-..."),
    ).toBeNull();
  });
});
