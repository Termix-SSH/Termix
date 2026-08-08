import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";

const mainAxios = vi.hoisted(() => ({
  checkElectronUpdate: vi.fn(),
}));

vi.mock("@/main-axios.ts", () => mainAxios);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

// The whole component is a no-op outside Electron, so every test here needs the
// desktop build.
vi.mock("@/lib/electron", () => ({ isElectron: () => true }));

import { ElectronVersionCheck } from "../../user/ElectronVersionCheck";

const DISMISS_KEY = "electron-version-check-dismissed";

type ElectronTestWindow = Window &
  typeof globalThis & {
    electronAPI?: { getAppVersion?: () => Promise<string | undefined> };
  };

function updateAvailable(localVersion: string, remoteVersion: string) {
  return {
    success: true,
    status: "requires_update" as const,
    localVersion,
    remoteVersion,
    latest_release: {
      tag_name: `v${remoteVersion}`,
      name: `Termix ${remoteVersion}`,
      published_at: "2026-07-01T00:00:00Z",
      html_url: `https://github.com/Termix-SSH/Termix/releases/tag/v${remoteVersion}`,
      body: "",
    },
  };
}

function upToDate(version: string) {
  return {
    success: true,
    status: "up_to_date" as const,
    localVersion: version,
    remoteVersion: version,
  };
}

// Renders and waits until the check has resolved and the modal body is on
// screen, so that a later `not.toHaveBeenCalled()` is not vacuously true.
async function renderAndSettle(onContinue: () => void) {
  render(<ElectronVersionCheck onContinue={onContinue} />);
  await waitFor(() => {
    expect(mainAxios.checkElectronUpdate).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(screen.getByText("common.continue")).toBeTruthy();
  });
}

beforeEach(() => {
  localStorage.clear();
  mainAxios.checkElectronUpdate.mockReset();
  (window as ElectronTestWindow).electronAPI = {
    getAppVersion: vi.fn(async () => "2.6.0"),
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as ElectronTestWindow).electronAPI;
});

describe("ElectronVersionCheck - dismissal is keyed on the offered version", () => {
  it("still prompts when the stored dismissal is the local version and a newer release exists", async () => {
    // Regression: the dismissal used to store the LOCAL version, and the
    // up-to-date branch wrote it with no user action at all. A user who ran
    // 2.6.0 while it was current had "2.6.0" stored, so once 2.6.1 shipped the
    // modal was skipped on every launch - suppressed for exactly the users who
    // had not updated yet.
    localStorage.setItem(DISMISS_KEY, "2.6.0");
    mainAxios.checkElectronUpdate.mockResolvedValue(
      updateAvailable("2.6.0", "2.6.1"),
    );
    const onContinue = vi.fn();

    await renderAndSettle(onContinue);

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText("versionCheck.updateRequired")).toBeTruthy();
  });

  it("stores the remote version when the user dismisses the prompt", async () => {
    mainAxios.checkElectronUpdate.mockResolvedValue(
      updateAvailable("2.6.0", "2.6.1"),
    );
    const onContinue = vi.fn();

    await renderAndSettle(onContinue);
    fireEvent.click(screen.getByText("common.continue"));

    await waitFor(() => {
      expect(localStorage.getItem(DISMISS_KEY)).toBe("2.6.1");
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("skips the prompt on a later launch offering the same remote version", async () => {
    localStorage.setItem(DISMISS_KEY, "2.6.1");
    mainAxios.checkElectronUpdate.mockResolvedValue(
      updateAvailable("2.6.0", "2.6.1"),
    );
    const onContinue = vi.fn();

    render(<ElectronVersionCheck onContinue={onContinue} />);

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledTimes(1);
    });
  });

  it("prompts again once a newer release than the dismissed one appears", async () => {
    localStorage.setItem(DISMISS_KEY, "2.6.1");
    mainAxios.checkElectronUpdate.mockResolvedValue(
      updateAvailable("2.6.0", "2.7.0"),
    );
    const onContinue = vi.fn();

    await renderAndSettle(onContinue);

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText("versionCheck.updateRequired")).toBeTruthy();
  });

  it("keys a dismissed beta prompt on the remote version too", async () => {
    // Local ahead of the published release: dismissing must still record what
    // was offered, so the next release re-prompts.
    mainAxios.checkElectronUpdate.mockResolvedValue({
      success: true,
      status: "beta" as const,
      localVersion: "2.7.0-beta",
      remoteVersion: "2.6.1",
    });
    const onContinue = vi.fn();

    await renderAndSettle(onContinue);
    // Both the modal title and the alert heading use this key.
    expect(screen.getAllByText("versionCheck.betaVersion").length).toBe(2);
    fireEvent.click(screen.getByText("common.continue"));

    await waitFor(() => {
      expect(localStorage.getItem(DISMISS_KEY)).toBe("2.6.1");
    });
  });

  it("continues without prompting when up to date, recording the offered version", async () => {
    mainAxios.checkElectronUpdate.mockResolvedValue(upToDate("2.6.1"));
    const onContinue = vi.fn();

    render(<ElectronVersionCheck onContinue={onContinue} />);

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem(DISMISS_KEY)).toBe("2.6.1");
  });

  it("does not record a dismissal when the check itself fails", async () => {
    mainAxios.checkElectronUpdate.mockResolvedValue({
      success: false,
      error: "Check failed",
    });
    const onContinue = vi.fn();

    await renderAndSettle(onContinue);

    // No offered version exists, so nothing may be written automatically and
    // nothing may be suppressed.
    expect(localStorage.getItem(DISMISS_KEY)).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("common.continue"));

    // Dismissing falls back to the local version, which cannot match a later
    // release and so cannot suppress its prompt.
    await waitFor(() => {
      expect(localStorage.getItem(DISMISS_KEY)).toBe("2.6.0");
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
