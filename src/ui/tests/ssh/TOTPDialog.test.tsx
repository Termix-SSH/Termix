import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TOTPDialog } from "@/ssh/dialogs/TOTPDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SSH password prompts", () => {
  it("accepts a full password and preserves whitespace", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TOTPDialog
        isOpen
        prompt="Password:"
        mode="password"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const input = container.querySelector("input")!;
    expect(input.type).toBe("password");
    expect(input).not.toHaveAttribute("maxLength");
    expect(input).not.toHaveAttribute("pattern");
    expect(input).not.toHaveAttribute("inputMode", "numeric");
    fireEvent.change(input, { target: { value: "  LongPassword!123  " } });
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledWith("  LongPassword!123  ");
    expect(screen.queryByText("sshAuth.totpRequired")).not.toBeInTheDocument();
  });

  it("still restricts verification codes to digits", () => {
    const { container } = render(
      <TOTPDialog
        isOpen
        prompt="Code:"
        mode="totp"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("input")).toHaveAttribute(
      "pattern",
      "[0-9]*",
    );
    expect(container.querySelector("input")).toHaveAttribute("maxLength", "8");
  });
});
