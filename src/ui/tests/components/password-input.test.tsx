import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PasswordInput } from "@/components/password-input";

afterEach(cleanup);

describe("PasswordInput", () => {
  it("keeps the browser from autofilling a saved login", () => {
    render(<PasswordInput aria-label="secret" />);
    expect(screen.getByLabelText("secret").getAttribute("autocomplete")).toBe(
      "new-password",
    );
  });

  it("lets a caller ask for another autocomplete hint", () => {
    render(
      <PasswordInput aria-label="secret" autoComplete="current-password" />,
    );
    expect(screen.getByLabelText("secret").getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });
});
