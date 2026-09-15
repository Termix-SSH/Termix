import { describe, expect, it } from "vitest";
import { parseNotificationAllowlist } from "../../utils/notification-egress.js";

describe("parseNotificationAllowlist", () => {
  it("defaults to an empty list", () => {
    expect(parseNotificationAllowlist(null)).toEqual([]);
    expect(parseNotificationAllowlist("invalid")).toEqual([]);
  });

  it("normalizes configured hosts", () => {
    expect(
      parseNotificationAllowlist(
        JSON.stringify([" NTFY.Internal ", "192.168.1.20", 42, ""]),
      ),
    ).toEqual(["ntfy.internal", "192.168.1.20"]);
  });
});
