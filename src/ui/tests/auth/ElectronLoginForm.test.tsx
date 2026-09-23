import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ElectronLoginForm } from "../../auth/ElectronLoginForm";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ElectronLoginForm", () => {
  it("delegates WebAuthn permissions to the embedded login page", () => {
    render(
      <ElectronLoginForm
        serverUrl="https://termix.example.com"
        onAuthSuccess={vi.fn()}
        onChangeServer={vi.fn()}
      />,
    );

    const permissions = screen
      .getByTitle("Server Authentication")
      .getAttribute("allow");

    expect(permissions).toContain("publickey-credentials-get");
    expect(permissions).toContain("publickey-credentials-create");
  });

  it.each([
    "auth_component",
    "totp_auth_component",
    "passkey_auth_component",
    "method_auth_component",
  ])("accepts a login hand-off from %s", async (source) => {
    const onAuthSuccess = vi.fn();
    render(
      <ElectronLoginForm
        serverUrl="https://termix.example.com"
        onAuthSuccess={onAuthSuccess}
        onChangeServer={vi.fn()}
      />,
    );
    const frame = screen.getByTitle(
      "Server Authentication",
    ) as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: "AUTH_SUCCESS",
          platform: "desktop",
          source,
          token: "jwt-1",
        },
      }),
    );
    await waitFor(() => expect(onAuthSuccess).toHaveBeenCalledWith("jwt-1"));
  });
});
