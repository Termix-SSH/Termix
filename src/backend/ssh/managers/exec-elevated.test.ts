import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

import { execElevated, ElevationError } from "./exec-elevated.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, stderr = "", code: number | null = 0) {
  return { stdout, stderr, code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("execElevated (no force)", () => {
  it("returns the direct result when the command succeeds unprivileged", async () => {
    execCommand.mockResolvedValueOnce(result("hello", "", 0));
    const r = await execElevated(fakeClient, "echo hello", "pw");
    expect(r.usedSudo).toBe(false);
    expect(r.stdout).toBe("hello");
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("does NOT escalate when stdout merely contains scary words", async () => {
    // A non-zero exit whose OUTPUT contains 'permission denied' but stderr does
    // not should be surfaced as-is, never retried under sudo.
    execCommand.mockResolvedValueOnce(
      result("log line: permission denied for user foo", "", 1),
    );
    const r = await execElevated(fakeClient, "grep denied /tmp/app.log", "pw");
    expect(r.usedSudo).toBe(false);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("escalates when stderr indicates a permission problem", async () => {
    execCommand
      .mockResolvedValueOnce(result("", "Permission denied", 1))
      .mockResolvedValueOnce(result("__TX_SUDO_OK__\nelevated output", "", 0));
    const r = await execElevated(fakeClient, "cat /etc/shadow", "pw");
    expect(r.usedSudo).toBe(true);
    expect(r.stdout).toBe("elevated output");
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it("throws SUDO_REQUIRED when elevation is needed but no password is set", async () => {
    execCommand.mockResolvedValueOnce(result("", "Permission denied", 1));
    await expect(
      execElevated(fakeClient, "cat /etc/shadow", undefined),
    ).rejects.toMatchObject({ code: "SUDO_REQUIRED" });
  });
});

describe("execElevated (forced)", () => {
  it("strips the success marker from stdout", async () => {
    execCommand.mockResolvedValueOnce(
      result("__TX_SUDO_OK__\nthe real output\n", "", 0),
    );
    const r = await execElevated(fakeClient, "id", "pw", { forceSudo: true });
    expect(r.stdout).toBe("the real output\n");
    expect(r.usedSudo).toBe(true);
  });

  it("does NOT throw when command output contains 'incorrect password' but sudo authenticated", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        "__TX_SUDO_OK__\nUser entered an incorrect password earlier",
        "",
        0,
      ),
    );
    const r = await execElevated(fakeClient, "tail /var/log/auth.log", "pw", {
      forceSudo: true,
    });
    expect(r.usedSudo).toBe(true);
    expect(r.stdout).toContain("incorrect password");
  });

  it("throws SUDO_FAILED on a real wrong-password (no marker, sudo stderr)", async () => {
    execCommand.mockResolvedValueOnce(
      result("", "sudo: 1 incorrect password attempt", 1),
    );
    await expect(
      execElevated(fakeClient, "id", "wrong", { forceSudo: true }),
    ).rejects.toMatchObject({ code: "SUDO_FAILED" });
  });

  it("throws NOT_SUDOER when the user is not in sudoers", async () => {
    execCommand.mockResolvedValueOnce(
      result("", "deploy is not in the sudoers file.", 1),
    );
    await expect(
      execElevated(fakeClient, "id", "pw", { forceSudo: true }),
    ).rejects.toMatchObject({ code: "NOT_SUDOER" });
  });

  it("throws SUDO_REQUIRED when forced without a password", async () => {
    await expect(
      execElevated(fakeClient, "id", undefined, { forceSudo: true }),
    ).rejects.toBeInstanceOf(ElevationError);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
