import { describe, it, expect } from "vitest";
import { buildSudoCommand, shellSingleQuote } from "./exec-elevated.js";
import { parsePlatformProbe } from "./platform.js";
import {
  isValidSystemdUnit,
  isValidPid,
  isValidPort,
  isValidPackageName,
  isValidUsername,
  isValidDomain,
  isValidDnsProvider,
  isValidSignal,
  isValidServiceAction,
  isAllowedPath,
} from "./validation.js";
import { parseServiceList, buildServiceActionCommand } from "./services.js";
import { parseProcessList, buildKillCommand } from "./processes.js";
import { parseDfMounts, parseTopMemory } from "./simple-reads.js";
import {
  parseCrontab,
  serializeCrontab,
  isValidCronSchedule,
  buildApplyCrontabCommand,
} from "./cron.js";
import {
  buildPackageActionCommand,
  parseUpgradable,
  buildListUpgradableCommand,
} from "./packages.js";
import {
  buildIssueCommand,
  buildRenewCommand,
  buildRevokeCommand,
  isValidCertName,
  parseCertbotCertificates,
} from "./ssl.js";
import { buildIptablesRuleCommand, buildNftRuleCommand } from "./firewall.js";
import { parsePasswd, parseSudoers } from "./users.js";
import { buildHealthCheckCommand, parseHealthResult } from "./health.js";
import { buildTailCommand, clampLines } from "./logs.js";

describe("exec-elevated", () => {
  it("single-quotes and escapes for the shell", () => {
    expect(shellSingleQuote("abc")).toBe("'abc'");
    expect(shellSingleQuote("a'b")).toBe(`'a'"'"'b'`);
  });
  it("builds the sudo -S pipeline wrapping the command in sh -c with a success marker", () => {
    expect(buildSudoCommand("systemctl restart nginx", "pw")).toBe(
      `echo 'pw' | sudo -S -p '' sh -c 'echo __TX_SUDO_OK__; systemctl restart nginx'`,
    );
  });
  it("does not merge stderr into stdout (no 2>&1)", () => {
    expect(buildSudoCommand("id", "pw")).not.toContain("2>&1");
  });
  it("escapes a password containing a quote", () => {
    expect(buildSudoCommand("id", "p'w")).toContain(`echo 'p'"'"'w'`);
  });
});

describe("platform probe parsing", () => {
  it("parses capabilities and prefers dnf over yum", () => {
    const out = [
      "systemd=1",
      "apt=0",
      "dnf=1",
      "yum=1",
      "pacman=0",
      "certbot=1",
      "acmesh=0",
      "docker=1",
      "os=Fedora Linux 40",
    ].join("\n");
    const p = parsePlatformProbe(out);
    expect(p.hasSystemd).toBe(true);
    expect(p.pkg).toBe("dnf");
    expect(p.hasCertbot).toBe(true);
    expect(p.hasAcmeSh).toBe(false);
    expect(p.hasDocker).toBe(true);
    expect(p.osPrettyName).toBe("Fedora Linux 40");
  });
  it("picks apt when present", () => {
    expect(parsePlatformProbe("apt=1\ndnf=1").pkg).toBe("apt");
  });
});

describe("validation (injection defense)", () => {
  it("systemd units", () => {
    expect(isValidSystemdUnit("nginx.service")).toBe(true);
    expect(isValidSystemdUnit("ssh.socket")).toBe(true);
    expect(isValidSystemdUnit("nginx.service; rm -rf /")).toBe(false);
    expect(isValidSystemdUnit("nginx")).toBe(false);
  });
  it("pids", () => {
    expect(isValidPid(123)).toBe(true);
    expect(isValidPid("123")).toBe(true);
    expect(isValidPid(0)).toBe(false);
    expect(isValidPid("1; reboot")).toBe(false);
    expect(isValidPid(-5)).toBe(false);
  });
  it("ports", () => {
    expect(isValidPort(443)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
  });
  it("package names", () => {
    expect(isValidPackageName("nginx")).toBe(true);
    expect(isValidPackageName("lib-foo.bar+1")).toBe(true);
    expect(isValidPackageName("nginx && curl evil")).toBe(false);
    expect(isValidPackageName("-rf")).toBe(false);
  });
  it("usernames and domains", () => {
    expect(isValidUsername("deploy")).toBe(true);
    expect(isValidUsername("root; rm")).toBe(false);
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("*.example.com")).toBe(true);
    expect(isValidDomain("ex ample.com")).toBe(false);
    expect(isValidDomain("a;b.com")).toBe(false);
  });
  it("dns providers, signals, service actions", () => {
    expect(isValidDnsProvider("cloudflare")).toBe(true);
    expect(isValidDnsProvider("cf; rm")).toBe(false);
    expect(isValidSignal("KILL")).toBe(true);
    expect(isValidSignal("BOOM")).toBe(false);
    expect(isValidServiceAction("restart")).toBe(true);
    expect(isValidServiceAction("destroy")).toBe(false);
  });
  it("path allowlist rejects traversal and out-of-allowlist", () => {
    expect(isAllowedPath("/var/log/syslog", ["/var/log"])).toBe(true);
    expect(isAllowedPath("/var/log/../../etc/passwd", ["/var/log"])).toBe(
      false,
    );
    expect(isAllowedPath("/etc/passwd", ["/var/log"])).toBe(false);
    expect(isAllowedPath("relative/path", ["/var/log"])).toBe(false);
  });
});

describe("services", () => {
  it("parses list-units --plain", () => {
    const out =
      "nginx.service loaded active running A high performance web server\n" +
      "ssh.service loaded active running OpenBSD Secure Shell server\n" +
      "cron.service loaded inactive dead Regular background program";
    const rows = parseServiceList(out);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ unit: "nginx.service", active: "active" });
    expect(rows[2].active).toBe("inactive");
  });
  it("builds action command", () => {
    expect(buildServiceActionCommand("nginx.service", "restart")).toBe(
      "systemctl restart nginx.service",
    );
  });
});

describe("processes", () => {
  it("parses ps output", () => {
    const out =
      "1234 1 root 12.5 3.2 45000 S /usr/bin/node node server.js\n" +
      "5678 1234 deploy 0.0 1.1 12000 Sl bash -bash";
    const rows = parseProcessList(out);
    expect(rows[0]).toMatchObject({
      pid: 1234,
      user: "root",
      cpu: 12.5,
      command: "/usr/bin/node",
    });
    expect(rows[1].pid).toBe(5678);
  });
  it("builds kill command", () => {
    expect(buildKillCommand(42, "TERM")).toBe("kill -TERM 42");
  });
});

describe("simple reads", () => {
  it("parses df -Pk and skips tmpfs", () => {
    const out =
      "/dev/sda1 100000 40000 60000 40% /\n" +
      "tmpfs 8000 0 8000 0% /dev/shm\n" +
      "/dev/sdb1 200000 100000 100000 50% /data";
    const mounts = parseDfMounts(out);
    expect(mounts).toHaveLength(2);
    expect(mounts[0].mount).toBe("/");
    expect(mounts[1].usePct).toBe(50);
  });
  it("parses top by memory", () => {
    const rows = parseTopMemory("1234 root 5.5 50000 node");
    expect(rows[0]).toMatchObject({ pid: 1234, mem: 5.5, command: "node" });
  });
});

describe("cron", () => {
  it("parses enabled and toggled entries", () => {
    const out = "0 2 * * * /backup.sh\n# 30 4 * * * /old.sh\nPATH=/usr/bin";
    const entries = parseCrontab(out);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ enabled: true, schedule: "0 2 * * *" });
    expect(entries[1].enabled).toBe(false);
  });
  it("validates schedules", () => {
    expect(isValidCronSchedule("0 2 * * *")).toBe(true);
    expect(isValidCronSchedule("@daily")).toBe(true);
    expect(isValidCronSchedule("not a schedule")).toBe(false);
  });
  it("serializes (commenting disabled entries) and round-trips", () => {
    const body = serializeCrontab([
      { raw: "", enabled: true, schedule: "0 2 * * *", command: "/a.sh" },
      { raw: "", enabled: false, schedule: "@daily", command: "/b.sh" },
    ]);
    expect(body).toBe("0 2 * * * /a.sh\n# @daily /b.sh\n");
    const reparsed = parseCrontab(body);
    expect(reparsed[0].enabled).toBe(true);
    expect(reparsed[1].enabled).toBe(false);
  });
  it("builds apply command piping into crontab -", () => {
    expect(buildApplyCrontabCommand("x\n")).toBe(
      `printf '%s' 'x\n' | crontab -`,
    );
  });
});

describe("packages", () => {
  it("builds per-distro commands", () => {
    expect(buildPackageActionCommand("apt", "install", "nginx")).toContain(
      "apt-get -y install nginx",
    );
    expect(buildPackageActionCommand("pacman", "upgrade-all")).toBe(
      "pacman -Syu --noconfirm",
    );
    expect(buildPackageActionCommand(null, "install", "x")).toBeNull();
  });
  it("lists per distro", () => {
    expect(buildListUpgradableCommand("apt")).toContain(
      "apt list --upgradable",
    );
    expect(buildListUpgradableCommand(null)).toBeNull();
  });
  it("parses apt upgradable", () => {
    const out =
      "nginx/focal-updates 1.18.0-2 amd64 [upgradable from: 1.18.0-1]";
    const pkgs = parseUpgradable("apt", out);
    expect(pkgs[0]).toMatchObject({
      name: "nginx",
      newVersion: "1.18.0-2",
      currentVersion: "1.18.0-1",
    });
  });
  it("parses pacman upgradable", () => {
    const pkgs = parseUpgradable("pacman", "linux 6.1 -> 6.2");
    expect(pkgs[0]).toMatchObject({ name: "linux", newVersion: "6.2" });
  });
});

describe("ssl (dual client)", () => {
  it("builds certbot issue for http + dns", () => {
    expect(
      buildIssueCommand({
        client: "certbot",
        domains: ["a.com"],
        challenge: "http-standalone",
      }),
    ).toContain(
      "certbot certonly --non-interactive --agree-tos --standalone -d 'a.com'",
    );
    expect(
      buildIssueCommand({
        client: "certbot",
        domains: ["a.com"],
        challenge: "dns",
        dnsProvider: "cloudflare",
      }),
    ).toContain("--dns-cloudflare");
  });
  it("builds acme.sh issue", () => {
    const cmd = buildIssueCommand({
      client: "acme.sh",
      domains: ["a.com", "b.com"],
      challenge: "dns",
      dnsProvider: "cf",
    });
    expect(cmd).toContain("--issue --dns dns_cf");
    expect(cmd).toContain("-d 'a.com'");
    expect(cmd).toContain("-d 'b.com'");
  });
  it("builds renew per client", () => {
    expect(buildRenewCommand("certbot", true)).toBe("certbot renew --dry-run");
    expect(buildRenewCommand("acme.sh", false)).toContain("--renew-all");
  });
  it("builds revoke per client", () => {
    expect(buildRevokeCommand("certbot", "example.com")).toBe(
      "certbot revoke --non-interactive --cert-name 'example.com' --delete-after-revoke",
    );
    const acme = buildRevokeCommand("acme.sh", "example.com");
    expect(acme).toContain("--revoke -d 'example.com'");
    expect(acme).toContain("--remove -d 'example.com'");
  });
  it("validates certificate names (rejects shell metachars)", () => {
    expect(isValidCertName("example.com")).toBe(true);
    expect(isValidCertName("example.com-0001")).toBe(true);
    expect(isValidCertName("*.example.com")).toBe(true);
    expect(isValidCertName("a.com; rm -rf /")).toBe(false);
    expect(isValidCertName("")).toBe(false);
    expect(isValidCertName(undefined)).toBe(false);
  });
  it("parses certbot certificates", () => {
    const out = [
      "Found the following certs:",
      "  Certificate Name: example.com",
      "    Domains: example.com www.example.com",
      "    Expiry Date: 2026-09-01 12:00:00+00:00 (VALID: 80 days)",
      "    Certificate Path: /etc/letsencrypt/live/example.com/fullchain.pem",
    ].join("\n");
    const certs = parseCertbotCertificates(out);
    expect(certs[0]).toMatchObject({
      name: "example.com",
      client: "certbot",
    });
    expect(certs[0].domains).toContain("www.example.com");
  });
});

describe("firewall", () => {
  it("builds iptables add/delete on INPUT only", () => {
    expect(
      buildIptablesRuleCommand("add", {
        protocol: "tcp",
        port: 443,
        target: "ACCEPT",
      }),
    ).toBe("iptables -A INPUT -p tcp --dport 443 -j ACCEPT");
    expect(
      buildIptablesRuleCommand("delete", {
        protocol: "udp",
        port: 53,
        target: "DROP",
      }),
    ).toBe("iptables -D INPUT -p udp --dport 53 -j DROP");
  });
  it("builds nft rules", () => {
    expect(
      buildNftRuleCommand("add", {
        protocol: "tcp",
        port: 22,
        target: "ACCEPT",
      }),
    ).toContain("add rule inet filter input tcp dport 22 accept");
  });
});

describe("users", () => {
  it("parses passwd for human users only", () => {
    const out =
      "root:x:0:0:root:/root:/bin/bash\n" +
      "deploy:x:1000:1000:Deploy:/home/deploy:/bin/bash\n" +
      "nobody:x:65534:65534:nobody:/:/usr/sbin/nologin";
    const users = parsePasswd(out);
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("deploy");
  });
  it("parses sudoers membership", () => {
    const out = "sudo:x:27:deploy,alice\nwheel:x:10:bob";
    expect(parseSudoers(out).sort()).toEqual(["alice", "bob", "deploy"]);
  });
});

describe("health checks", () => {
  it("builds tcp and http commands", () => {
    const tcp = buildHealthCheckCommand({
      id: "1",
      name: "ssh",
      type: "tcp",
      target: "localhost",
      port: 22,
    });
    expect(tcp).toContain("/dev/tcp/");
    const http = buildHealthCheckCommand({
      id: "2",
      name: "web",
      type: "http",
      target: "example.com",
      path: "/health",
    });
    expect(http).toContain("curl -s -o /dev/null");
    expect(http).toContain("http://example.com/health");
  });
  it("parses tcp and http results", () => {
    const tcp = parseHealthResult(
      { id: "1", name: "ssh", type: "tcp", target: "h", port: 22 },
      "ok 12",
    );
    expect(tcp).toMatchObject({ ok: true, latencyMs: 12 });
    const http = parseHealthResult(
      { id: "2", name: "web", type: "http", target: "h" },
      "200 0.045",
    );
    expect(http).toMatchObject({ ok: true, latencyMs: 45 });
    const bad = parseHealthResult(
      { id: "3", name: "web", type: "http", target: "h" },
      "500 0.01",
    );
    expect(bad.ok).toBe(false);
  });
});

describe("logs", () => {
  it("clamps line counts", () => {
    expect(clampLines(50)).toBe(50);
    expect(clampLines(99999)).toBe(2000);
    expect(clampLines("abc")).toBe(200);
    expect(clampLines(0)).toBe(1);
  });
  it("builds a quoted tail command without suppressing stderr", () => {
    expect(buildTailCommand("/var/log/syslog", 100)).toBe(
      "tail -n 100 '/var/log/syslog'",
    );
  });
});
