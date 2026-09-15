import { describe, it, expect } from "vitest";
import {
  parseDfLines,
  findWorstMountIndex,
  buildFilesystemList,
  selectPrimaryFilesystem,
  filterExcludedFilesystems,
  mergeMonitoredFilesystems,
  parseWindowsDiskJson,
  parseDarwinMountTypes,
  parseDarwinDfRows,
} from "../../../../hosts/metrics/widgets/disk-collector.js";

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

// Representative output shape from `df -Pk` and `mount` on a modern macOS
// (Sonoma/Sequoia, Apple Silicon) system, where the APFS root volume group
// surfaces as several synthetic system volumes alongside the real "/" and
// "/System/Volumes/Data" mounts.
const DARWIN_DF_OUTPUT =
  "Filesystem   1024-blocks      Used Available Capacity Mounted on\n" +
  "/dev/disk3s1s1  971350180  10904432 723545416    2%    /\n" +
  "devfs                 205       205         0  100%    /dev\n" +
  "/dev/disk3s6    971350180   8437248 723545416    2%    /System/Volumes/VM\n" +
  "/dev/disk3s2    971350180   6067864 723545416    1%    /System/Volumes/Preboot\n" +
  "/dev/disk3s4    971350180     16612 723545416    1%    /System/Volumes/Update\n" +
  "/dev/disk1s2         500098      6104    479950    2%    /System/Volumes/xarts\n" +
  "/dev/disk1s1         500098      5388    479950    2%    /System/Volumes/iSCPreboot\n" +
  "/dev/disk1s3         500098        36    479950    1%    /System/Volumes/Hardware\n" +
  "/dev/disk3s5    971350180 235925064 723545416   25%    /System/Volumes/Data\n" +
  "map auto_home             0         0         0  100%    /System/Volumes/Data/home\n";

const DARWIN_MOUNT_OUTPUT =
  "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n" +
  "devfs on /dev (devfs, local, nobrowse)\n" +
  "/dev/disk3s6 on /System/Volumes/VM (apfs, local, noexec, journaled, noatime, nobrowse)\n" +
  "/dev/disk3s2 on /System/Volumes/Preboot (apfs, local, journaled, nobrowse)\n" +
  "/dev/disk3s4 on /System/Volumes/Update (apfs, local, journaled, nobrowse)\n" +
  "/dev/disk1s2 on /System/Volumes/xarts (apfs, local, noexec, journaled, noatime, nobrowse)\n" +
  "/dev/disk1s1 on /System/Volumes/iSCPreboot (apfs, local, journaled, nobrowse)\n" +
  "/dev/disk1s3 on /System/Volumes/Hardware (apfs, local, journaled, nobrowse)\n" +
  "/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse)\n" +
  "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)\n";

describe("parseDarwinMountTypes", () => {
  it("maps each mount point to its filesystem type", () => {
    const map = parseDarwinMountTypes(DARWIN_MOUNT_OUTPUT);
    expect(map.get("/")).toBe("apfs");
    expect(map.get("/dev")).toBe("devfs");
    expect(map.get("/System/Volumes/Data/home")).toBe("autofs");
  });
});

describe("parseDarwinDfRows", () => {
  it("parses real `df -Pk` rows and drops devfs/autofs and synthetic system volumes", () => {
    const typeByMount = parseDarwinMountTypes(DARWIN_MOUNT_OUTPUT);
    const rows = parseDarwinDfRows(DARWIN_DF_OUTPUT, typeByMount);

    expect(rows.map((r) => r.mount)).toEqual(["/", "/System/Volumes/Data"]);

    const root = rows[0];
    expect(root.type).toBe("apfs");
    expect(root.totalBytes).toBe(971350180 * 1024);
    expect(root.usedBytes).toBe(10904432 * 1024);
    expect(root.availableBytes).toBe(723545416 * 1024);
    // Our percent is used/total (matches the Linux/Windows collectors), which
    // differs slightly from df's own Capacity% (used/(used+available)).
    expect(root.percent).toBe(1);
    expect(root.usedHuman).toBeTruthy();
    expect(root.totalHuman).toBeTruthy();
  });

  it("returns an empty list for blank output", () => {
    expect(parseDarwinDfRows("", new Map())).toEqual([]);
  });
});

describe("parseWindowsDiskJson", () => {
  it("handles ConvertTo-Json collapsing a single result to an object", () => {
    const rows = parseWindowsDiskJson(
      '{"drive":"C:","total":1000000000,"free":400000000}',
    );
    expect(rows).toEqual([{ drive: "C:", total: 1000000000, free: 400000000 }]);
  });

  it("parses an array of drives", () => {
    const rows = parseWindowsDiskJson(
      '[{"drive":"C:","total":1000,"free":400},{"drive":"D:","total":2000,"free":1900}]',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ drive: "D:", total: 2000, free: 1900 });
  });

  it("drops drives with a zero or missing total", () => {
    const rows = parseWindowsDiskJson(
      '[{"drive":"C:","total":0,"free":0},{"drive":"D:","total":100,"free":50}]',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].drive).toBe("D:");
  });

  it("returns an empty array for blank or invalid output", () => {
    expect(parseWindowsDiskJson("")).toEqual([]);
    expect(parseWindowsDiskJson("not json")).toEqual([]);
  });
});
