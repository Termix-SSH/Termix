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
      .getByTitle("auth.serverAuthentication")
      .getAttribute("allow");

    expect(permissions).toContain("publickey-credentials-get");
    expect(permissions).toContain("publickey-credentials-create");
  });

  it.each([
    "auth_component",
    "second_factor_auth_component",
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
      "auth.serverAuthentication",
    ) as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://termix.example.com",
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

  it("ignores messages once the frame has left the server's origin", async () => {
    const onAuthSuccess = vi.fn();
    const externalBrowserLogin = vi.fn();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      externalBrowserLogin,
    };
    render(
      <ElectronLoginForm
        serverUrl="https://termix.example.com/"
        onAuthSuccess={onAuthSuccess}
        onChangeServer={vi.fn()}
      />,
    );
    const frame = screen.getByTitle(
      "auth.serverAuthentication",
    ) as HTMLIFrameElement;
    for (const data of [
      {
        type: "AUTH_SUCCESS",
        platform: "desktop",
        source: "auth_component",
        token: "attacker-jwt",
      },
      {
        type: "OIDC_SYSTEM_BROWSER_AUTH",
        authUrl: "https://evil.example/",
        callbackPort: 17832,
      },
    ]) {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "https://evil.example",
          data,
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAuthSuccess).not.toHaveBeenCalled();
    expect(externalBrowserLogin).not.toHaveBeenCalled();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("replies to the server's origin only", async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      externalBrowserLogin: vi.fn().mockResolvedValue({
        success: false,
        secondFactor: true,
        tempToken: "temp-1",
      }),
    };
    render(
      <ElectronLoginForm
        serverUrl="https://termix.example.com/"
        onAuthSuccess={vi.fn()}
        onChangeServer={vi.fn()}
      />,
    );
    const frame = screen.getByTitle(
      "auth.serverAuthentication",
    ) as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://termix.example.com",
        data: {
          type: "OIDC_SYSTEM_BROWSER_AUTH",
          authUrl: "https://idp.example.com/authorize",
          callbackPort: 17832,
          providerId: -1,
        },
      }),
    );
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ tempToken: "temp-1" }),
        "https://termix.example.com",
      ),
    );
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });
});
