import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { TOTPDialog } from "@/ssh/dialogs/TOTPDialog";

afterEach(cleanup);

describe("TOTPDialog", () => {
  it("submits the code", () => {
    const onSubmit = vi.fn();
    render(
      <TOTPDialog isOpen prompt="" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByRole("dialog", { name: "sshAuth.totpRequired" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("000000"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "sshAuth.totpVerify" }));
    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("sends an empty answer for a push prompt and then waits", () => {
    const onSubmit = vi.fn();
    render(
      <TOTPDialog
        isOpen
        prompt=""
        mode="push"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "sshAuth.mfaSendRequest" }),
    );
    expect(onSubmit).toHaveBeenCalledWith("");
    expect(screen.getByText("sshAuth.mfaWaitingApproval")).toBeTruthy();
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    render(
      <TOTPDialog isOpen prompt="" onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    render(
      <TOTPDialog
        isOpen={false}
        prompt=""
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
