import { describe, expect, it } from "vitest";
import { validateHostForm } from "@/manage/host-validation";

describe("validateHostForm", () => {
  it("needs an address", () => {
    expect(
      validateHostForm({ ip: " ", sshPort: 22 }, { enableSsh: true }),
    ).toEqual({
      ip: "manage.errorAddressRequired",
    });
  });

  it("checks the SSH port only when SSH is on", () => {
    expect(
      validateHostForm({ ip: "h", sshPort: 70000 }, { enableSsh: true }),
    ).toEqual({ sshPort: "manage.errorPortRange" });
    expect(
      validateHostForm({ ip: "h", sshPort: 70000 }, { enableSsh: false }),
    ).toEqual({});
  });
});
