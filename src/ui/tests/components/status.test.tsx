import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StatusBadge, StatusDot, statusTone } from "../../components/status";

afterEach(cleanup);

describe("statusTone", () => {
  it("maps common state words", () => {
    expect(statusTone("Running")).toBe("ok");
    expect(statusTone("CrashLoopBackOff")).toBe("bad");
    expect(statusTone("pending approval")).toBe("warn");
    expect(statusTone("exited")).toBe("idle");
  });

  it("treats unknown and empty states as idle", () => {
    expect(statusTone("banana")).toBe("idle");
    expect(statusTone(null)).toBe("idle");
  });
});

describe("StatusBadge", () => {
  it("shows the state with its tone", () => {
    render(<StatusBadge state="failed" />);
    expect(screen.getByText("failed")).toHaveClass("text-destructive");
  });

  it("lets a tone win over the state", () => {
    render(
      <StatusBadge state="failed" tone="ok">
        Fine
      </StatusBadge>,
    );
    expect(screen.getByText("Fine")).toHaveClass("text-green-500");
  });
});

describe("StatusDot", () => {
  it("colors by state", () => {
    render(<StatusDot state="running" title="up" />);
    expect(screen.getByTitle("up")).toHaveClass("bg-green-500");
  });
});
