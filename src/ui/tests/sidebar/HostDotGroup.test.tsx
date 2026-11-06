import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HostDotGroup } from "@/sidebar/HostDotGroup";
import {
  hostDotReporter,
  type HostBadgeDef,
  type HostDot,
} from "@/sidebar/host-contributions";
import type { Host } from "@/types/ui-types";

afterEach(cleanup);

const host = { id: 1, name: "web" } as unknown as Host;

function badge(id: string, dot: HostDot | null): HostBadgeDef {
  return { id, when: () => true, dot: hostDotReporter(() => dot) };
}

describe("HostDotGroup", () => {
  it("draws one dot with the worst tone for many reports", () => {
    render(
      <HostDotGroup
        host={host}
        badges={[
          badge("uptime", { tone: "bad", label: "1 monitor down" }),
          badge("ops", { tone: "warn", label: "Disk: 91%" }),
        ]}
      />,
    );
    const dots = screen.getAllByTestId("host-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0].firstElementChild!.className).toContain("bg-destructive");
  });

  it("draws nothing when no badge reports", () => {
    render(<HostDotGroup host={host} badges={[badge("uptime", null)]} />);
    expect(screen.queryByTestId("host-dot")).toBeNull();
  });
});
