import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TransferProgressBar } from "../../../features/file-manager/components/TransferProgressBar";

afterEach(cleanup);

describe("TransferProgressBar", () => {
  it("exposes determinate progress and drives the fill with a transform", () => {
    const { container } = render(
      <TransferProgressBar value={42} label="Uploading archive" />,
    );

    const progress = screen.getByRole("progressbar", {
      name: "Uploading archive",
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("42");
    expect(progress.getAttribute("aria-busy")).toBe("false");
    expect(
      container
        .querySelector<HTMLElement>(".transfer-progress-fill")
        ?.style.getPropertyValue("--transfer-progress"),
    ).toBe("0.42");
  });

  it("clamps invalid percentages before exposing them", () => {
    const { rerender } = render(
      <TransferProgressBar value={140} label="Uploading archive" />,
    );

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );

    rerender(<TransferProgressBar value={-20} label="Uploading archive" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "0",
    );
  });

  it("marks unknown and stalled progress without inventing a percentage", () => {
    const { container } = render(
      <TransferProgressBar label="Reconnecting" stalled />,
    );

    const progress = screen.getByRole("progressbar");
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.getAttribute("aria-busy")).toBe("true");
    expect(progress.getAttribute("data-stalled")).toBe("true");
    expect(
      container
        .querySelector(".transfer-progress-fill")
        ?.classList.contains("transfer-progress-indeterminate"),
    ).toBe(true);
    expect(
      container
        .querySelector(".transfer-progress-fill")
        ?.classList.contains("transfer-progress-stalled"),
    ).toBe(true);
  });
});
