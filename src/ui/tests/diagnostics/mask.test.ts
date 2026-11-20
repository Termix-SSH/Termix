import { describe, expect, it } from "vitest";
import { Masker, noMask } from "@/diagnostics/mask";
import { redactData, redactText, redactUrl } from "@/diagnostics/redact";

describe("Masker", () => {
  it("gives each value one stable placeholder", () => {
    const masker = new Masker({
      hosts: ["10.0.0.5", "web-prod.example.com"],
      users: ["alice"],
      serverHost: "termix.strasser.internal",
    });
    const out = masker.text(
      "alice connected to web-prod.example.com (10.0.0.5) from 192.168.1.20 via termix.strasser.internal; alice again, mail bob@example.org",
    );
    expect(out).toBe(
      "user-1 connected to host-1 (host-2) from ip-1 via server-host; user-1 again, mail email-1",
    );
  });

  it("keeps clock times, loopback and versions", () => {
    const masker = new Masker();
    const line =
      "[5:30:46 AM] 2026-11-19T05:30:35.908Z 127.0.0.1 ::1 plugin@1.4.2 v26.11.2";
    expect(masker.text(line)).toBe(line);
  });

  it("masks IPv6 and short names safely", () => {
    const masker = new Masker({ users: ["ab", "root"] });
    expect(masker.text("from fd00:1234::5 as ab root")).toBe(
      "from ip-1 as ab root",
    );
  });

  it("masks account names in home folder paths", () => {
    const masker = new Masker();
    expect(
      masker.text(
        "entry C:\\Users\\Luke\\Termix\\dist is missing, also /home/bob/x and C:\\\\Users\\\\Luke\\\\y",
      ),
    ).toBe(
      "entry C:\\Users\\user-1\\Termix\\dist is missing, also /home/user-2/x and C:\\\\Users\\\\user-1\\\\y",
    );
  });

  it("masks keys and values in objects", () => {
    const masker = new Masker({ hosts: ["db1.lan"] });
    expect(masker.value({ "db1.lan": { ip: "10.1.1.1", ok: 1 } })).toEqual({
      "host-1": { ip: "ip-1", ok: 1 },
    });
  });

  it("noMask leaves everything", () => {
    expect(noMask.text("10.0.0.1")).toBe("10.0.0.1");
  });
});

describe("redact", () => {
  it("removes secrets from text", () => {
    expect(
      redactText(
        "Bearer abc.def eyJa.eyJb.sig tmx_aaaaaaaaaaaaaaaaaaaa cookie jwt=xyz; ?token=1",
      ),
    ).toBe(
      "Bearer [MASKED] [JWT] tmx_[MASKED] cookie jwt=[MASKED]; ?token=[MASKED]",
    );
  });

  it("masks secret keys deep in data", () => {
    expect(
      redactData({ a: { password: "x", apiKey: "y", list: [{ token: 1 }] } }),
    ).toEqual({
      a: {
        password: "[MASKED]",
        apiKey: "[MASKED]",
        list: [{ token: "[MASKED]" }],
      },
    });
  });

  it("keeps a URL's path but not its query values or login", () => {
    expect(
      redactUrl(
        "https://u:p@x.test/plugin-assets/ai/frontend.js?v=3&token=9#a",
      ),
    ).toBe("https://x.test/plugin-assets/ai/frontend.js?v=...&token=...#...");
    expect(redactUrl("/users/me", "http://h.test/")).toBe(
      "http://h.test/users/me",
    );
  });
});
