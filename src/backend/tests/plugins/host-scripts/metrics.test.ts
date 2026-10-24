import { describe, it, expect } from "vitest";
import {
  buildFilesystemList,
  filterExcludedFilesystems,
  findWorstMountIndex,
  liveCmd,
  mergeMonitoredFilesystems,
  parseCpuLine,
  parseDfLines,
  parseLive,
  selectPrimaryFilesystem,
} from "@termix-ssh/plugin-sdk/host-scripts";

describe("parseCpuLine", () => {
  it("parses a standard /proc/stat cpu line", () => {
    // user nice system idle iowait irq softirq
    const result = parseCpuLine("cpu  100 0 50 800 30 0 20");
    expect(result).toBeDefined();
    // idle = idle(800) + iowait(30)
    expect(result?.idle).toBe(830);
    // total = sum of all fields
    expect(result?.total).toBe(100 + 0 + 50 + 800 + 30 + 0 + 20);
  });

  it("tolerates leading/trailing whitespace", () => {
    const result = parseCpuLine("  cpu 1 2 3 4  ");
    expect(result?.total).toBe(10);
    expect(result?.idle).toBe(4);
  });

  it("returns undefined for non-cpu lines", () => {
    expect(parseCpuLine("cpu0 1 2 3 4")).toBeUndefined();
    expect(parseCpuLine("intr 12345")).toBeUndefined();
  });

  it("returns undefined when there are fewer than 4 numeric fields", () => {
    expect(parseCpuLine("cpu 1 2 3")).toBeUndefined();
  });
});

describe("parseDfLines", () => {
  it("parses df -T -P output into rows", () => {
    const output =
      "/dev/nvme0n1p2 ext4 3848290697216 1046898851840 2606516101120  29% /\n" +
      "/dev/nvme1n1p1 ext4 15393162788864 15239230844928 153931922841  99% /data\n";
    const rows = parseDfLines(output);
    expect(rows).toHaveLength(2);
    expect(rows[0].mount).toBe("/");
    expect(rows[0].type).toBe("ext4");
    expect(rows[1].mount).toBe("/data");
  });

  it("filters out pseudo filesystems", () => {
    const output =
      "tmpfs tmpfs 8000 0 8000 0% /dev/shm\n" +
      "overlay overlay 100 50 50 50% /\n" +
      "/dev/sda1 ext4 100 50 50 50% /mnt/data\n";
    const rows = parseDfLines(output);
    expect(rows).toHaveLength(1);
    expect(rows[0].mount).toBe("/mnt/data");
  });

  it("captures the filesystem type for network shares", () => {
    const output =
      "nas.local:/export nfs4 2000 1900 100 95% /mnt/nas\n" +
      "//server/share cifs 2000 1000 1000 50% /mnt/smb\n";
    const rows = parseDfLines(output);
    expect(rows[0].type).toBe("nfs4");
    expect(rows[1].type).toBe("cifs");
  });

  it("keeps full image and firmware mounts out of disk usage", () => {
    const rows = parseDfLines(
      "/dev/loop0 squashfs 100 100 0 100% /snap/core/1\n" +
        "efivarfs efivarfs 100 89 11 89% /sys/firmware/efi/efivars\n" +
        "/dev/sda1 ext4 1000 400 600 40% /\n",
    );
    expect(rows.map((row) => row.mount)).toEqual(["/"]);
    expect(findWorstMountIndex(rows)).toEqual({
      index: 0,
      usedBytes: 400,
      totalBytes: 1000,
    });
  });

  it("retains real storage without requiring a /dev source", () => {
    const rows = parseDfLines(
      "/dev/sda1 btrfs 1000 400 600 40% /\n" +
        "tank/data zfs 2000 1000 1000 50% /data\n" +
        "nas:/export nfs4 2000 1900 100 95% /mnt/nas\n" +
        "//server/share cifs 2000 1000 1000 50% /mnt/smb\n",
    );
    expect(rows.map((row) => row.type)).toEqual([
      "btrfs",
      "zfs",
      "nfs4",
      "cifs",
    ]);
  });
});

describe("findWorstMountIndex", () => {
  it("picks the most-utilized mount, not just the first row", () => {
    const rows = parseDfLines(
      "/dev/nvme0n1p2 ext4 3848290697216 1046898851840 2606516101120  29% /\n" +
        "/dev/nvme1n1p1 ext4 15393162788864 15239230844928 153931922841  99% /data\n",
    );
    const worst = findWorstMountIndex(rows);
    expect(worst.index).toBe(1);
    expect(worst.totalBytes).toBe(15393162788864);
    expect(worst.usedBytes).toBe(15239230844928);
  });

  it("falls back to the only mount available", () => {
    const rows = parseDfLines("/dev/sda1 ext4 100 30 70 30% /\n");
    const worst = findWorstMountIndex(rows);
    expect(worst.index).toBe(0);
  });

  it("skips rows with invalid or zero totals", () => {
    const rows = parseDfLines(
      "/dev/sda1 ext4 0 0 0 0% /broken\n" +
        "/dev/sda2 ext4 100 40 60 40% /ok\n",
    );
    const worst = findWorstMountIndex(rows);
    expect(worst.index).toBe(1);
  });

  it("returns index -1 when there are no usable rows", () => {
    const worst = findWorstMountIndex([]);
    expect(worst.index).toBe(-1);
    expect(worst.totalBytes).toBe(0);
  });
});

const BYTES_OUTPUT =
  "/dev/nvme0n1p2 ext4 1000 400 600 40% /\n" +
  "/dev/nvme1n1p1 ext4 2000 1900 100 95% /data\n";
const HUMAN_OUTPUT =
  "/dev/nvme0n1p2 ext4 1.0K 400 600 40% /\n" +
  "/dev/nvme1n1p1 ext4 2.0K 1.9K 100 95% /data\n";

describe("buildFilesystemList", () => {
  it("returns every real filesystem with byte maths and human strings", () => {
    const list = buildFilesystemList(
      parseDfLines(BYTES_OUTPUT),
      parseDfLines(HUMAN_OUTPUT),
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      mount: "/",
      type: "ext4",
      percent: 40,
      usedHuman: "400",
      totalHuman: "1.0K",
      availableHuman: "600",
      usedBytes: 400,
      totalBytes: 1000,
    });
    expect(list[1]).toMatchObject({ mount: "/data", percent: 95 });
  });

  it("matches human rows by mount when the row counts differ", () => {
    const list = buildFilesystemList(
      parseDfLines(BYTES_OUTPUT),
      parseDfLines("/dev/nvme1n1p1 ext4 2.0K 1.9K 100 95% /data\n"),
    );
    expect(list[0].totalHuman).toBeNull();
    expect(list[1].totalHuman).toBe("2.0K");
  });

  it("drops filesystems with a zero or invalid total", () => {
    const list = buildFilesystemList(
      parseDfLines(
        "/dev/sda1 ext4 0 0 0 0% /broken\n/dev/sda2 ext4 100 40 60 40% /ok\n",
      ),
      [],
    );
    expect(list).toHaveLength(1);
    expect(list[0].mount).toBe("/ok");
  });
});

describe("selectPrimaryFilesystem", () => {
  it("prefers root over a fuller secondary mount", () => {
    const list = buildFilesystemList(
      parseDfLines(BYTES_OUTPUT),
      parseDfLines(HUMAN_OUTPUT),
    );
    expect(selectPrimaryFilesystem(list)?.mount).toBe("/");
  });

  it("falls back to the most-utilized mount when there is no root", () => {
    const list = buildFilesystemList(
      parseDfLines(
        "/dev/sda1 ext4 1000 100 900 10% /mnt/a\n" +
          "/dev/sda2 ext4 1000 800 200 80% /mnt/b\n",
      ),
      [],
    );
    expect(selectPrimaryFilesystem(list)?.mount).toBe("/mnt/b");
  });

  it("returns null for an empty list", () => {
    expect(selectPrimaryFilesystem([])).toBeNull();
  });
});

describe("filterExcludedFilesystems", () => {
  const list = buildFilesystemList(
    parseDfLines(
      "/dev/sda1 ext4 1000 400 600 40% /\n" +
        "nas.local:/export nfs4 2000 1900 100 95% /mnt/nas\n" +
        "//server/share cifs 2000 1000 1000 50% /mnt/smb\n",
    ),
    [],
  );

  it("returns the same list when no mounts are excluded", () => {
    expect(filterExcludedFilesystems(list)).toHaveLength(3);
    expect(filterExcludedFilesystems(list, [])).toHaveLength(3);
  });

  it("excludes an exact mount path match", () => {
    const filtered = filterExcludedFilesystems(list, ["/mnt/nas"]);
    expect(filtered.map((fs) => fs.mount)).toEqual(["/", "/mnt/smb"]);
  });

  it("excludes by filesystem type substring, case-insensitively", () => {
    const filtered = filterExcludedFilesystems(list, ["NFS"]);
    expect(filtered.map((fs) => fs.mount)).toEqual(["/", "/mnt/smb"]);
  });

  it("supports excluding multiple network filesystem types at once", () => {
    const filtered = filterExcludedFilesystems(list, ["nfs", "cifs"]);
    expect(filtered.map((fs) => fs.mount)).toEqual(["/"]);
  });

  it("ignores blank/whitespace-only entries", () => {
    const filtered = filterExcludedFilesystems(list, ["  ", ""]);
    expect(filtered).toHaveLength(3);
  });
});

describe("mergeMonitoredFilesystems", () => {
  it("adds an arbitrary path with a user label", () => {
    const detected = buildFilesystemList(
      parseDfLines("/dev/sda1 ext4 1000 400 600 40% /\n"),
      [],
    );
    const custom = buildFilesystemList(
      parseDfLines("/dev/sda1 ext4 1000 400 600 40% /\n"),
      [],
    );
    const result = mergeMonitoredFilesystems(
      detected,
      [{ path: "/config", label: "Home Assistant" }],
      custom,
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      mount: "/config",
      label: "Home Assistant",
      totalBytes: 1000,
    });
  });

  it("labels a path that is already a detected mount", () => {
    const detected = buildFilesystemList(
      parseDfLines("/dev/sda1 ext4 1000 400 600 40% /data\n"),
      [],
    );
    const result = mergeMonitoredFilesystems(
      detected,
      [{ path: "/data", label: "Media" }],
      detected,
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Media");
  });
});

const out = (
  agg: [number, number],
  core: [number, number],
  rx: number,
  up: number,
  procs: string,
  page = "4096",
) =>
  [
    `cpu  ${agg[0]} 0 0 ${agg[1]} 0 0 0 0 0 0\ncpu0 ${core[0]} 0 0 ${core[1]} 0 0 0 0 0 0`,
    "MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB",
    `0.1 0.2 0.3 1/2 3\n${up} 5`,
    `Inter-|\n eth0: ${rx} 0 0 0 0 0 0 0 ${rx * 2} 0\n lo: 9 0 0 0 0 0 0 0 9 0`,
    page,
    procs,
  ].join("\n@@\n");

const proc = (pid: number, ticks: number, start: number, name = "java") =>
  `${pid}\t${ticks}\t10\t${start}\tR\t1\t${name}\n`;

describe("parseLive extras", () => {
  it("reports state, parent, CPU mix, cache and the running count", () => {
    const mk = (user: number, sys: number, wait: number, idle: number) =>
      out([user, idle], [user, idle], 1, 10, procs).replace(
        /cpu {2}\d+ 0 0 \d+ 0 0 0 0/,
        `cpu  ${user} 0 ${sys} ${idle} ${wait} 0 0 0`,
      );
    const procs = "5\t1\t10\t7\tR\t2\tjava\n6\t1\t10\t8\tS\t5\tsh\n";
    const a = parseLive(mk(0, 0, 0, 0), undefined, 0);
    const b = parseLive(mk(30, 10, 10, 50), a.next, 1000);
    expect(b.sample.cpuMix).toMatchObject({ user: 30, system: 10, iowait: 10 });
    expect(b.sample.running).toBe(1);
    expect(b.sample.procs.find((p) => p.pid === 6)).toMatchObject({
      state: "S",
      ppid: 5,
    });
    expect(b.sample.memCachedKb).toBe(0);
  });
});

describe("liveCmd", () => {
  it("asks for the page size once, then passes the cached number", () => {
    expect(liveCmd()).toContain('pg="$(getconf PAGESIZE)"');
    expect(liveCmd(16384)).toContain("pg=16384 ");
    expect(liveCmd(16384)).not.toContain("getconf");
  });
});

describe("parseLive", () => {
  it("has no rates on the first sample", () => {
    const { sample } = parseLive(
      out([100, 100], [100, 100], 1000, 10, proc(7, 0, 1)),
      undefined,
    );
    expect(sample.cpu).toBeNull();
    expect(sample.net[0].rxBps).toBeNull();
    expect(sample.memUsedKb).toBe(600);
  });

  it("derives cpu, per-core, net and process rates from the delta", () => {
    const a = parseLive(
      out([100, 100], [100, 100], 1000, 10, proc(7, 0, 1)),
      undefined,
    );
    // aggregate: +50 busy, +50 idle; core 0: +25 busy, +75 idle
    const { sample } = parseLive(
      out([150, 150], [125, 175], 3000, 11, proc(7, 50, 1)),
      a.next,
    );
    expect(sample.cpu).toBeCloseTo(50, 0);
    expect(sample.cores[0]).toBeCloseTo(25, 0);
    expect(sample.net).toEqual([{ name: "eth0", rxBps: 2000, txBps: 4000 }]);
    expect(sample.procs[0]).toMatchObject({ pid: 7, name: "java", memKb: 40 });
    expect(sample.procs[0].cpu).toBeCloseTo(50, 0);
  });

  it("does not charge a reused pid with the old process's ticks", () => {
    const a = parseLive(
      out([100, 100], [100, 100], 1000, 10, proc(7, 5, 1)),
      undefined,
    );
    // same pid, new start time, lower ticks must not look like a huge delta
    const { sample } = parseLive(
      out([150, 150], [125, 175], 3000, 11, proc(7, 9000, 2)),
      a.next,
    );
    expect(sample.procs[0].cpu).toBe(0);
  });

  it("keeps the cached page size when a run omits it, and keeps names with tabs", () => {
    const a = parseLive(
      out([1, 1], [1, 1], 1, 10, proc(1, 0, 1), "16384"),
      undefined,
    );
    expect(a.next.pageBytes).toBe(16384);
    const b = parseLive(
      out([2, 2], [2, 2], 2, 11, proc(1, 0, 1, "a	b"), ""),
      a.next,
    );
    expect(b.next.pageBytes).toBe(16384);
    expect(b.sample.procs[0]).toMatchObject({ name: "a\tb", memKb: 160 });
  });

  it("starts rates again after a reboot", () => {
    const a = parseLive(
      out([100, 100], [100, 100], 5000, 900, proc(7, 0, 1)),
      undefined,
    );
    const { sample } = parseLive(
      out([10, 10], [10, 10], 20, 5, proc(7, 0, 1)),
      a.next,
    );
    expect(sample.cpu).toBeNull();
    expect(sample.net[0].rxBps).toBeNull();
  });
});
