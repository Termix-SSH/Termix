import { describe, expect, it } from "vitest";
import {
  buildDirectProbeCommand,
  buildDirectRsyncCommand,
  quoteShell,
  shouldBenchmarkDirectTransfer,
  shouldUseDirectTransfer,
} from "../../../hosts/file-manager/direct-transfer-routing.js";

const endpoint = { host: "10.0.0.2", port: 2222, username: "deploy" };

describe("direct transfer routing", () => {
  it("keeps small transfers on the relay without benchmarking", () => {
    expect(shouldBenchmarkDirectTransfer(32 * 1024 * 1024 - 1)).toBe(false);
    expect(shouldBenchmarkDirectTransfer(32 * 1024 * 1024)).toBe(true);
  });

  it("requires a meaningful speed advantage", () => {
    expect(shouldUseDirectTransfer(700, 1000)).toBe(true);
    expect(shouldUseDirectTransfer(850, 1000)).toBe(false);
    expect(shouldUseDirectTransfer(0, 1000)).toBe(false);
  });

  it("probes without accepting passwords or unknown host keys", () => {
    const command = buildDirectProbeCommand(endpoint);
    expect(command).toContain("BatchMode=yes");
    expect(command).toContain("StrictHostKeyChecking=yes");
    expect(command).toContain("ConnectTimeout=5");
    expect(command).toContain("-p 2222");
  });

  it("quotes source and destination paths for rsync", () => {
    const command = buildDirectRsyncCommand(
      endpoint,
      ["/srv/a file", "/srv/it's-safe"],
      "/opt/releases",
      true,
    );
    expect(command).toContain("--partial --append-verify");
    expect(command).toContain("--protect-args");
    expect(command).toContain(quoteShell("/srv/a file"));
    expect(command).toContain(quoteShell("/srv/it's-safe"));
    expect(command).toContain("deploy@10.0.0.2:/opt/releases/");
  });

  it("brackets IPv6 destinations", () => {
    const command = buildDirectProbeCommand({
      host: "2001:db8::2",
      port: 22,
      username: "root",
    });
    expect(command).toContain("root@[2001:db8::2]");
  });
});
