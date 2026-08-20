import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsRepository = { getBoolean: vi.fn() };
const userPreferenceRepository = { findByUserId: vi.fn() };

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => settingsRepository,
  createCurrentUserPreferenceRepository: () => userPreferenceRepository,
}));

const { isAiGloballyEnabled, resolveAiAccess } =
  await import("../../ai/gating.js");

describe("AI gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to off so upgrading an install enables nothing", async () => {
    settingsRepository.getBoolean.mockResolvedValue(false);
    await isAiGloballyEnabled();
    expect(settingsRepository.getBoolean).toHaveBeenCalledWith(
      "ai_globally_enabled",
      false,
    );
  });

  it("blocks everyone when the admin global is off", async () => {
    settingsRepository.getBoolean.mockResolvedValue(false);
    userPreferenceRepository.findByUserId.mockResolvedValue({
      aiAssistantEnabled: true,
      aiReadOnlyCommands: true,
    });

    const access = await resolveAiAccess("user-1");

    expect(access.enabled).toBe(false);
    expect(access.allowReadOnlyCommands).toBe(false);
    // The kill switch short-circuits, so the preference is never consulted.
    expect(userPreferenceRepository.findByUserId).not.toHaveBeenCalled();
  });

  it("blocks a user who has not enabled it", async () => {
    settingsRepository.getBoolean.mockResolvedValue(true);
    userPreferenceRepository.findByUserId.mockResolvedValue({
      aiAssistantEnabled: false,
    });

    expect((await resolveAiAccess("user-1")).enabled).toBe(false);
  });

  it("treats never-asked as not enabled", async () => {
    // Null means the user was never shown the choice, which is not consent.
    settingsRepository.getBoolean.mockResolvedValue(true);
    userPreferenceRepository.findByUserId.mockResolvedValue({
      aiAssistantEnabled: null,
    });

    expect((await resolveAiAccess("user-1")).enabled).toBe(false);
  });

  it("treats a missing preference row as not enabled", async () => {
    settingsRepository.getBoolean.mockResolvedValue(true);
    userPreferenceRepository.findByUserId.mockResolvedValue(null);

    expect((await resolveAiAccess("user-1")).enabled).toBe(false);
  });

  it("allows only when both gates are open", async () => {
    settingsRepository.getBoolean.mockResolvedValue(true);
    userPreferenceRepository.findByUserId.mockResolvedValue({
      aiAssistantEnabled: true,
      aiReadOnlyCommands: true,
    });

    const access = await resolveAiAccess("user-1");

    expect(access.enabled).toBe(true);
    expect(access.allowReadOnlyCommands).toBe(true);
  });

  it("keeps read-only commands off unless separately opted in", async () => {
    settingsRepository.getBoolean.mockResolvedValue(true);
    userPreferenceRepository.findByUserId.mockResolvedValue({
      aiAssistantEnabled: true,
      aiReadOnlyCommands: null,
    });

    const access = await resolveAiAccess("user-1");

    expect(access.enabled).toBe(true);
    expect(access.allowReadOnlyCommands).toBe(false);
  });
});
