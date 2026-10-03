import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { installScript } from "../../../src/backend/agents/install.js";

it("refuses corrupted Node.js downloads before extracting or installing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "termix-install-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh
for arg do previous="$last"; last="$arg"; done
case "$last" in
 *SHASUMS256.txt) printf '%064d  node-v24.1.0-linux-x64.tar.gz\\n' 0 > "$last";;
 *) echo corrupted > "$last";;
esac
`,
      { mode: 0o700 },
    );
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n',
      { mode: 0o700 },
    );
    let output = "";
    try {
      execFileSync("sh", ["-c", installScript("pi")], {
        env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` },
        stdio: "pipe",
      });
    } catch (error) {
      output = String((error as { stdout: Buffer }).stdout);
    }
    expect(output).toContain("Node.js SHA-256 verification failed");
    await expect(
      readFile(join(dir, ".local/share/termix-agent-runtime/node/bin/node")),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects a mirror dependency before npm ci", async () => {
  const dir = await mkdtemp(join(tmpdir(), "termix-registry-"));
  try {
    const script = installScript("pi")
      .split("node - <<'VERIFY'\n")[1]
      .split("\nVERIFY")[0];
    await writeFile(
      join(dir, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/injected": {
            version: "1.0.0",
            resolved: "https://mirror.invalid/pkg.tgz",
            integrity: "sha512-fake",
          },
        },
      }),
    );
    expect(() =>
      execFileSync(process.execPath, ["-e", script], {
        cwd: dir,
        stdio: "pipe",
      }),
    ).toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
