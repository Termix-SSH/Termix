import type { Express } from "express";
import { collectFirewallMetrics } from "../widgets/firewall-collector.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import {
  isValidPort,
  isValidIpProtocol,
  isValidFirewallTarget,
  type IpProtocol,
  type FirewallTarget,
} from "./validation.js";
import { detectPlatform } from "./platform.js";
import type { ManagerRoutesDeps } from "./types.js";

export interface FirewallRuleSpec {
  protocol: IpProtocol;
  port: number;
  target: FirewallTarget;
}

/**
 * Build an iptables add/delete for an INPUT rule. We only ever touch INPUT for a
 * specific dport with an explicit target, and never the chain policy, so an
 * existing ESTABLISHED/SSH rule is left intact.
 */
export function buildIptablesRuleCommand(
  op: "add" | "delete",
  spec: FirewallRuleSpec,
): string {
  const flag = op === "add" ? "-A" : "-D";
  return `iptables ${flag} INPUT -p ${spec.protocol} --dport ${spec.port} -j ${spec.target}`;
}

export function buildNftRuleCommand(
  op: "add" | "delete",
  spec: FirewallRuleSpec,
): string {
  // nftables uses the inet filter table's input chain by convention.
  const verb = op === "add" ? "add" : "delete";
  const action =
    spec.target.toLowerCase() === "reject"
      ? "reject"
      : spec.target.toLowerCase();
  return `nft ${verb} rule inet filter input ${spec.protocol} dport ${spec.port} ${action}`;
}

export function registerFirewallRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/firewall/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "firewall_read", async (client) => {
      return await collectFirewallMetrics(client);
    }),
  );

  app.post(
    "/host-metrics/managers/firewall/:id/rule",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "firewall_rule",
      async (client, host, req) => {
        const { op, protocol, port, target } = req.body as {
          op?: "add" | "delete";
          protocol?: string;
          port?: number;
          target?: string;
        };
        if (op !== "add" && op !== "delete") {
          throw new ManagerInputError("Invalid op");
        }
        if (!isValidIpProtocol(protocol))
          throw new ManagerInputError("Invalid protocol");
        if (!isValidPort(port)) throw new ManagerInputError("Invalid port");
        if (!isValidFirewallTarget(target))
          throw new ManagerInputError("Invalid target");

        const spec: FirewallRuleSpec = {
          protocol,
          port: Number(port),
          target,
        };
        const fw = await collectFirewallMetrics(client);
        const cmd =
          fw.type === "nftables"
            ? buildNftRuleCommand(op, spec)
            : buildIptablesRuleCommand(op, spec);
        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
        });
        return {
          success: result.code === 0,
          output: result.stdout || result.stderr,
          backend: fw.type,
        };
      },
    ),
  );

  app.post(
    "/host-metrics/managers/firewall/:id/persist",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "firewall_persist",
      async (client, host) => {
        const platform = await detectPlatform(client);
        // Best-effort persistence across common tools.
        const cmd =
          "(command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save) || " +
          "(command -v service >/dev/null 2>&1 && service iptables save) || " +
          "(command -v nft >/dev/null 2>&1 && nft list ruleset > /etc/nftables.conf) || true";
        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
        });
        return {
          success: result.code === 0,
          output: result.stdout || result.stderr,
          pkg: platform.pkg,
        };
      },
    ),
  );
}
