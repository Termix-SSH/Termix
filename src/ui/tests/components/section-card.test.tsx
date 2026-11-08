import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakeSwitch, SettingRow } from "@/components/section-card";

describe("FakeSwitch", () => {
  it("takes its name from the setting row around it", () => {
    render(
      <SettingRow label="Enable tunnels">
        <FakeSwitch />
      </SettingRow>,
    );
    expect(screen.getByRole("switch", { name: "Enable tunnels" })).toBeTruthy();
  });

  it("prefers its own label", () => {
    render(
      <SettingRow label="Row">
        <FakeSwitch aria-label="Own name" />
      </SettingRow>,
    );
    expect(screen.getByRole("switch", { name: "Own name" })).toBeTruthy();
  });
});
