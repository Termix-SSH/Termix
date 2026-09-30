import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownRenderer } from "../../../src/frontend/components/MarkdownRenderer";

afterEach(cleanup);

describe("Markdown preview text copying", () => {
  it.each([false, true])(
    "supports copying in compact=%s previews",
    (compact) => {
      const fileShortcut = vi.fn();
      document.addEventListener("keydown", fileShortcut);
      try {
        const { container } = render(
          <div className="select-none">
            <MarkdownRenderer
              compact={compact}
              content={"# Preview\n\nCopy this text."}
            />
          </div>,
        );
        const preview = container.querySelector<HTMLElement>(".select-text")!;
        preview.focus();
        expect(preview).toHaveFocus();
        expect(
          screen.getByRole("heading", { name: "Preview" }),
        ).toBeInTheDocument();
        for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
          expect(fireEvent.keyDown(preview, { key: "c", ...modifier })).toBe(
            true,
          );
        }
        expect(fileShortcut).not.toHaveBeenCalled();
        fireEvent.keyDown(preview, { key: "Escape" });
        expect(fileShortcut).toHaveBeenCalledTimes(1);
        expect(fireEvent.contextMenu(preview)).toBe(true);
      } finally {
        document.removeEventListener("keydown", fileShortcut);
      }
    },
  );
});
