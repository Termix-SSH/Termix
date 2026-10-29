import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  actionScript,
  errLine,
  isActiveScript,
  listUnitsScript,
  openRcActionScript,
  parseKeys,
  passwordSudoScript,
  scriptError,
  scriptShell,
  SUDO_REFUSED_RE,
  SUDO_WRONG_RE,
  toBase64,
  utf8Decode,
  utf8Encode,
  watchdog,
} from "@termix-ssh/plugin-sdk/host-scripts";

describe("text helpers", () => {
  it("encodes base64 like Buffer does", () => {
    for (const text of [
      "",
      "a",
      "ab",
      "abc",
      "héllo wörld",
      "emoji 🙂 here",
      "line\nbreak",
    ]) {
      expect(toBase64(text)).toBe(Buffer.from(text, "utf8").toString("base64"));
    }
  });

  it("round trips UTF-8 and replaces bad bytes", () => {
    const text = "plain, ünïcode, 日本, 🙂";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(Array.from(utf8Encode(text))).toEqual(
      Array.from(Buffer.from(text, "utf8")),
    );
    expect(utf8Decode([0x61, 0xff, 0x62])).toBe("a\ufffdb");
    expect(utf8Decode([0xe6, 0x97])).toBe("\ufffd");
  });

  it("reads key=value lines", () => {
    expect(parseKeys("a=1\nb = two=2\njunk\n")).toEqual({ a: "1", b: "two=2" });
  });
});

describe("script shells", () => {
  it("always reads the script from stdin", () => {
    for (const mode of ["plain", "auto", "root"] as const) {
      expect(scriptShell(mode)).toContain("bash -s");
    }
    expect(scriptShell("auto")).toContain("sudo -n true");
    expect(scriptShell("root-only")).toContain("SCRIPT_ERR:");
  });

  it("collects error lines, old and new markers", () => {
    expect(scriptError("x\nSCRIPT_ERR:one\nSERVICES_ERR:two\n")).toBe(
      "one\ntwo",
    );
    expect(errLine("it's broken")).toBe(`echo 'SCRIPT_ERR:it'\\''s broken'`);
  });

  it("matches sudo refusals", () => {
    expect(SUDO_REFUSED_RE.test("sudo: a password is required")).toBe(true);
    expect(SUDO_WRONG_RE.test("sudo: 1 incorrect password attempt")).toBe(true);
  });

  it("keeps the sudo password out of the command line", () => {
    const { command, stdin } = passwordSudoScript(
      "systemctl restart 'a.service'\n",
      "s3cr'et $(id)",
    );
    expect(command).not.toContain("s3cr");
    expect(stdin.split("\n")[0]).toBe("IFS= read -r TERMIX_PW");
    expect(stdin.split("\n")[1]).toBe("s3cr'et $(id)");
    expect(stdin).toContain("sudo -k -S -p ''");
    expect(stdin).not.toContain("systemctl restart");
    expect(() => passwordSudoScript("x", "a\nb")).toThrow();
  });

  it.runIf(process.platform !== "win32")(
    "runs the script and never runs the password",
    () => {
      const { stdin } = passwordSudoScript(
        'echo "ran:$1${TERMIX_PW:-none}"\n',
        "touch /tmp/should-not-exist",
      );
      // No sudo here: swap it for a fake that drops its own stdin line.
      const fake = stdin.replace(
        /printf '%s\\n' "\$P" \| sudo -k -S -p '' env PATH="\$PATH" [^\n]* bash -c "\$TERMIX_S"/,
        'printf "%s\\n" "$P" | { IFS= read -r _; bash -c "$TERMIX_S"; }',
      );
      expect(fake).not.toBe(stdin);
      const out = execFileSync(
        "bash",
        ["-c", "sudo() { return 1; }; export -f sudo; exec bash -s"],
        {
          input: fake,
          encoding: "utf8",
        },
      );
      expect(out.trim()).toBe("ran:none");
    },
  );
});

describe("unit scripts", () => {
  it("quotes units and refuses bad names", () => {
    expect(actionScript("a.service", "enable-now")).toContain(
      "systemctl enable --now -- 'a.service'",
    );
    expect(() => actionScript("a;b.service", "start")).toThrow();
    expect(isActiveScript(["a.service", "b.timer"])).toContain(
      "-- 'a.service' 'b.timer'",
    );
    expect(() => listUnitsScript("bogus" as never)).toThrow();
    expect(openRcActionScript("sshd", "enable")).toContain(
      "rc-update add 'sshd' default",
    );
    expect(() => openRcActionScript("sshd", "mask")).toThrow();
  });

  it("stops a watched command once stdin closes", () => {
    expect(watchdog("journalctl -f")).toContain("cat >/dev/null");
  });
});
