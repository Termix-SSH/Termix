import { render, screen } from "@testing-library/react";
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
});
