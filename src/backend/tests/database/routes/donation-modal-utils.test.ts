import { describe, it, expect } from "vitest";
import { shouldShowDonationModal } from "../../../database/routes/donation-modal-utils.js";

describe("shouldShowDonationModal", () => {
  const now = Date.parse("2026-07-17T00:00:00.000Z");

  it("returns false when the user already dismissed it", () => {
    const registeredAt = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldShowDonationModal(registeredAt, true, now)).toBe(false);
  });

  it("returns false before the 30 day mark", () => {
    const registeredAt = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldShowDonationModal(registeredAt, false, now)).toBe(false);
  });

  it("returns true at exactly 30 days", () => {
    const registeredAt = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldShowDonationModal(registeredAt, false, now)).toBe(true);
  });

  it("returns true well past the 30 day mark", () => {
    const registeredAt = new Date(
      now - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(shouldShowDonationModal(registeredAt, false, now)).toBe(true);
  });

  it("returns false for an unparseable registeredAt", () => {
    expect(shouldShowDonationModal("not-a-date", false, now)).toBe(false);
  });

  it("treats a backdated registeredAt for pre-existing users as immediately eligible", () => {
    const registeredAt = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldShowDonationModal(registeredAt, false, now)).toBe(true);
  });
});
