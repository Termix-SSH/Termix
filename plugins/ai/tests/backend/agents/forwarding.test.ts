import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FORWARDING_ADMIN_SCRIPT,
  forwardingScript,
} from "../../../src/backend/agents/forwarding.js";

// These run sh, git and agent binaries the way a remote Linux host does.
const posix = it.skipIf(process.platform === "win32");

async function fixture(mode = "no") {
  const dir = await mkdtemp(join(tmpdir(), "termix-forwarding-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  const original = `Port 2222\nAllowTcpForwarding ${mode}\nMatch Address 10.1.1.3\n  DenyUsers root\n`;
  await writeFile(join(dir, "sshd_config"), original);
  await writeFile(
    join(bin, "sshd"),
    `#!${process.execPath}
const fs=require('fs'),a=process.argv.slice(2),dir=${JSON.stringify(dir)};
const file=a.includes('-f')?a[a.indexOf('-f')+1]:dir+'/sshd_config';
if(a.includes('-t')){if(a.includes('-f')&&fs.existsSync(dir+'/invalid-candidate'))process.exit(1);process.exit(0);}
const text=fs.readFileSync(file,'utf8'),rule=text.match(/Match User root Address 10.1.1.35\\n  AllowTcpForwarding (\\w+)/);
console.log('allowtcpforwarding '+(rule?rule[1]:${JSON.stringify(mode)}));
console.log('permitlisten '+(rule?'127.0.0.1:*':'any'));
console.log('gatewayports no\\ndisableforwarding no');
`,
    { mode: 0o700 },
  );
  await writeFile(
    join(bin, "systemctl"),
    `#!/bin/sh
if [ "$1" = reload ] && [ -f '${dir}/fail-reload' ]; then rm '${dir}/fail-reload'; exit 1; fi
exit 0
`,
    { mode: 0o700 },
  );
  const script = FORWARDING_ADMIN_SCRIPT.replaceAll(
    "/usr/sbin/sshd",
    join(bin, "sshd"),
  ).replaceAll("/etc/ssh", dir);
  const run = () =>
    execFileSync("sh", ["-c", script, "termix", "root", "10.1.1.35"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: "pipe",
    }).toString();
  return {
    dir,
    original,
    run,
    config: () => readFile(join(dir, "sshd_config"), "utf8"),
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

posix(
  "adds a scoped rule before existing Match blocks and is idempotent",
  async () => {
    const f = await fixture();
    try {
      expect(f.run()).toContain("Enabled loopback remote forwarding");
      const config = await f.config();
      expect(config).toContain(
        "AllowTcpForwarding no\n# BEGIN Termix Agent root 10.1.1.35\nMatch User root Address 10.1.1.35\n  AllowTcpForwarding remote\n  PermitListen 127.0.0.1:*\n  GatewayPorts no",
      );
      expect(config).toContain("Match Address 10.1.1.3\n  DenyUsers root");
      expect(f.run()).toContain("already allowed");
      expect(await f.config()).toBe(config);
    } finally {
      await f.close();
    }
  },
);
posix("preserves existing local forwarding", async () => {
  const f = await fixture("local");
  try {
    f.run();
    expect(await f.config()).toContain("  AllowTcpForwarding yes");
  } finally {
    await f.close();
  }
});
for (const failure of ["invalid-candidate", "fail-reload"]) {
  it(`retains the original SSH configuration after ${failure}`, async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.dir, failure), "1");
      expect(f.run).toThrow();
      expect(await f.config()).toBe(f.original);
    } finally {
      await f.close();
    }
  });
}
it("rejects a malformed connection source before privilege escalation", () => {
  expect(() =>
    execFileSync("sh", ["-c", forwardingScript()], {
      env: { ...process.env, SSH_CONNECTION: "1.2.3.4;bad 123 1.2.3.5 22" },
      stdio: "pipe",
    }),
  ).toThrow();
});
