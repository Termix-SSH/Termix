import { describe, expect, it } from "vitest";
import {
  isUnit,
  journalArgs,
  parseBoots,
  parseDetect,
  parseEntry,
  parseIsActive,
  parseJournal,
  parseJournalQuery,
  parseOpenRcList,
  parseSystemdTime,
  parseTimers,
  parseUnitList,
  parseUsage,
  shellQuote as q,
  vacuumScript,
} from "@termix-ssh/plugin-sdk/host-scripts";

describe("names", () => {
  it("quotes for bash", () => {
    expect(q("a'b")).toBe(`'a'\\''b'`);
  });

  it("takes unit names and refuses anything else", () => {
    expect(isUnit("nginx.service")).toBe(true);
    expect(isUnit("getty@tty1.service")).toBe(true);
    expect(isUnit("dev-disk-by\\x2duuid-1.device")).toBe(true);
    expect(isUnit("-rf.service")).toBe(false);
    expect(isUnit("a;b.service")).toBe(false);
    expect(isUnit("a b.service")).toBe(false);
    expect(isUnit("nginx")).toBe(false);
    expect(isUnit("$(id).service")).toBe(false);
  });
});

describe("systemd parsing", () => {
  const list = [
    "cron.service           loaded    active   running Regular background program",
    "● bad.service      loaded    failed   failed  Broken thing",
    "getty@tty1.service     loaded    active   running Getty on tty1",
    "@@TERMIX_FILES@@",
    "cron.service           enabled   enabled",
    "bad.service            disabled  enabled",
    "getty@.service         enabled   enabled",
    "old.service            masked    -",
    "",
  ].join("\n");

  it("merges loaded units with unit files and skips templates", () => {
    const units = parseUnitList(list);
    expect(units.map((u) => u.name)).toEqual([
      "bad.service",
      "cron.service",
      "getty@tty1.service",
      "old.service",
    ]);
    const cron = units.find((u) => u.name === "cron.service")!;
    expect(cron).toMatchObject({
      active: "active",
      sub: "running",
      description: "Regular background program",
      fileState: "enabled",
      preset: "enabled",
    });
    expect(units.find((u) => u.name === "bad.service")!.active).toBe("failed");
    expect(units.find((u) => u.name === "old.service")).toMatchObject({
      load: "masked",
      active: "inactive",
      preset: "",
    });
  });

  it("reads UTC times", () => {
    expect(parseSystemdTime("Thu 2026-10-22 02:03:51 UTC")).toBe(
      Date.UTC(2026, 9, 22, 2, 3, 51),
    );
    expect(parseSystemdTime("")).toBeNull();
    expect(parseSystemdTime("n/a")).toBeNull();
  });

  it("reads timers from systemctl show blocks", () => {
    const out = [
      "TimersCalendar={ OnCalendar=*-*-* 06,18:00:00 ; next_elapse=@1792605600 }",
      "NextElapseUSecRealtime=Thu 2026-10-22 02:03:51 UTC",
      "LastTriggerUSec=Wed 2026-10-21 17:02:58 UTC",
      "Id=apt-daily.timer",
      "Triggers=apt-daily.service",
      "ActiveState=active",
      "",
      "TimersMonotonic={ OnUnitActiveUSec=1d ; next_elapse=1d }",
      "TimersMonotonic={ OnBootUSec=15min ; next_elapse=15min }",
      "NextElapseUSecRealtime=",
      "LastTriggerUSec=",
      "Id=clean.timer",
      "Triggers=clean.service",
    ].join("\n");
    const timers = parseTimers(out);
    expect(timers[0]).toMatchObject({
      name: "apt-daily.timer",
      activates: "apt-daily.service",
      next: Date.UTC(2026, 9, 22, 2, 3, 51),
      schedule: ["OnCalendar=*-*-* 06,18:00:00"],
    });
    expect(timers[1]).toMatchObject({
      name: "clean.timer",
      next: null,
      last: null,
      schedule: ["OnUnitActiveUSec=1d", "OnBootUSec=15min"],
    });
  });

  it("maps is-active lines to units", () => {
    const states = parseIsActive(
      ["a.service", "b.service"],
      "active\nfailed\n",
    );
    expect(states.get("a.service")).toBe("active");
    expect(states.get("b.service")).toBe("failed");
  });

  it("reads what detect prints", () => {
    expect(
      parseDetect(
        "init=systemd\nversion=257\nos=Debian GNU/Linux 13 (trixie)\nuid=0\njournal=1\nfailed=2\n",
      ),
    ).toMatchObject({
      init: "systemd",
      version: "257",
      root: true,
      journal: true,
      failed: 2,
    });
    expect(parseDetect("init=weird\nuid=1000\n")).toMatchObject({
      init: "none",
      root: false,
    });
  });
});

describe("journal", () => {
  it("checks filters", () => {
    const query = parseJournalQuery({
      unit: ["nginx.service", "ssh.service"],
      priority: "3",
      since: "-1h",
      boot: "-1",
      grep: "fail'ed",
      lines: "99999",
    });
    expect(query.lines).toBe(5000);
    const args = journalArgs(query);
    expect(args).toContain("-u 'nginx.service' -u 'ssh.service'");
    expect(args).toContain("-p 3");
    expect(args).toContain("--since '-1h'");
    expect(args).toContain("-b '-1'");
    expect(args).toContain(`-g 'fail'\\''ed'`);
    expect(() => parseJournalQuery({ unit: "x;rm" })).toThrow();
    expect(() => parseJournalQuery({ priority: "9" })).toThrow();
    expect(() => parseJournalQuery({ since: "$(id)" })).toThrow();
    expect(() => parseJournalQuery({ boot: "abc" })).toThrow();
  });

  it("parses entries, binary messages included", () => {
    const entry = parseEntry(
      JSON.stringify({
        __REALTIME_TIMESTAMP: "1792612429684000",
        PRIORITY: "3",
        _SYSTEMD_UNIT: "x.service",
        SYSLOG_IDENTIFIER: "x",
        _PID: "12",
        MESSAGE: [104, 105],
      }),
    );
    expect(entry).toEqual({
      time: 1792612429684,
      priority: 3,
      unit: "x.service",
      ident: "x",
      pid: "12",
      message: "hi",
    });
    expect(parseEntry("not json")).toBeNull();
  });

  it("filters here when journalctl has no -g", () => {
    const line = (message: string) =>
      JSON.stringify({ __REALTIME_TIMESTAMP: "1000", MESSAGE: message });
    const out = `@@TERMIX_NOGREP@@\n${line("Disk Error")}\n${line("ok")}\n`;
    const query = parseJournalQuery({ grep: "error", lines: "10" });
    expect(parseJournal(out, query).map((e) => e.message)).toEqual([
      "Disk Error",
    ]);
  });

  it("reads boots and disk use", () => {
    const boots = parseBoots(
      [
        "IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY",
        "-1 d2785a657f4c4561a1f436db27555b50 Tue 2026-10-20 13:56:45 UTC Wed 2026-10-21 10:37:00 UTC",
        "  0 61b15588a75b4c0cb8dea321fcc438ab Wed 2026-10-21 10:38:10 UTC Wed 2026-10-21 20:00:00 UTC",
      ].join("\n"),
    );
    expect(boots.map((b) => b.offset)).toEqual([0, -1]);
    expect(boots[0].first).toBe("Wed 2026-10-21 10:38:10 UTC");
    expect(
      parseUsage(
        "Archived and active journals take up 378.6M in the file system.",
      ),
    ).toBe("378.6M");
  });

  it("only takes sane vacuum values", () => {
    expect(vacuumScript({ size: "500M" })).toContain("--vacuum-size=500M");
    expect(vacuumScript({ time: "4w" })).toContain("--vacuum-time=4w");
    expect(() => vacuumScript({ size: "1; rm -rf /" })).toThrow();
    expect(() => vacuumScript({})).toThrow();
  });
});

describe("openrc", () => {
  it("maps services and runlevels", () => {
    const units = parseOpenRcList(
      [
        " sshd                 [  started  ]",
        " crond                [  stopped  ]",
        " nginx                [  crashed  ]",
        "@@TERMIX_RUNLEVELS@@",
        "            sshd | default",
        "           nginx | ",
        "",
      ].join("\n"),
    );
    expect(units.find((u) => u.name === "sshd")).toMatchObject({
      active: "active",
      fileState: "enabled",
    });
    expect(units.find((u) => u.name === "nginx")).toMatchObject({
      active: "failed",
      fileState: "disabled",
    });
    expect(units.find((u) => u.name === "crond")!.active).toBe("inactive");
  });
});
