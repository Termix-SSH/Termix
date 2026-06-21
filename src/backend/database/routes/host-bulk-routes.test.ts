import { describe, it, expect } from "vitest";
import { parseSSHConfig } from "./host-bulk-routes.js";

describe("parseSSHConfig", () => {
  it("parses a basic Host block", () => {
    const config = `
Host myserver
    HostName 192.168.1.10
    User alice
    Port 2222
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "myserver",
      hostname: "192.168.1.10",
      user: "alice",
      port: 2222,
    });
  });

  it("parses multiple Host blocks", () => {
    const config = `
Host web
    HostName web.example.com
    User deploy

Host db
    HostName db.example.com
    User postgres
    Port 5432
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("web");
    expect(result[1].name).toBe("db");
    expect(result[1].port).toBe(5432);
  });

  it("ignores comment lines", () => {
    const config = `
# This is a comment
Host server
    # Another comment
    HostName 10.0.0.1
    User root
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].hostname).toBe("10.0.0.1");
  });

  it("skips wildcard Host entries", () => {
    const config = `
Host *
    ServerAliveInterval 60

Host prod
    HostName prod.example.com
    User ubuntu
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("prod");
  });

  it("captures IdentityFile and ProxyJump", () => {
    const config = `
Host bastion
    HostName bastion.example.com
    User ec2-user
    IdentityFile ~/.ssh/id_rsa
    ProxyJump jumphost.example.com
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].identityFile).toBe("~/.ssh/id_rsa");
    expect(result[0].proxyJump).toBe("jumphost.example.com");
  });

  it("skips Host blocks without a HostName", () => {
    const config = `
Host alias-only
    User foo
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(0);
  });

  it("defaults port to undefined when not specified", () => {
    const config = `
Host server
    HostName 1.2.3.4
    User root
`;
    const result = parseSSHConfig(config);
    expect(result[0].port).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    expect(parseSSHConfig("")).toHaveLength(0);
    expect(parseSSHConfig("   \n\n  ")).toHaveLength(0);
  });
});
