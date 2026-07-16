import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import type {
  FirewallMetrics,
  FirewallChain,
  FirewallRule,
} from "../../../types/stats-widgets.js";

function parseIptablesRule(line: string): FirewallRule | null {
  if (!line.startsWith("-A ")) return null;

  const rule: FirewallRule = {
    chain: "",
    target: "",
    protocol: "all",
    source: "0.0.0.0/0",
    destination: "0.0.0.0/0",
  };

  const chainMatch = line.match(/^-A\s+(\S+)/);
  if (chainMatch) {
    rule.chain = chainMatch[1];
  }

  const targetMatch = line.match(/-j\s+(\S+)/);
  if (targetMatch) {
    rule.target = targetMatch[1];
  }

  const protocolMatch = line.match(/-p\s+(\S+)/);
  if (protocolMatch) {
    rule.protocol = protocolMatch[1];
  }

  const sourceMatch = line.match(/-s\s+(\S+)/);
  if (sourceMatch) {
    rule.source = sourceMatch[1];
  }

  const destMatch = line.match(/-d\s+(\S+)/);
  if (destMatch) {
    rule.destination = destMatch[1];
  }

  const dportMatch = line.match(/--dport\s+(\S+)/);
  if (dportMatch) {
    rule.dport = dportMatch[1];
  }

  const sportMatch = line.match(/--sport\s+(\S+)/);
  if (sportMatch) {
    rule.sport = sportMatch[1];
  }

  const stateMatch = line.match(/--state\s+(\S+)/);
  if (stateMatch) {
    rule.state = stateMatch[1];
  }

  const interfaceMatch = line.match(/-i\s+(\S+)/);
  if (interfaceMatch) {
    rule.interface = interfaceMatch[1];
  }

  return rule;
}

function parseIptablesOutput(output: string): FirewallChain[] {
  const chains: Map<string, FirewallChain> = new Map();
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    const policyMatch = trimmed.match(/^:(\S+)\s+(\S+)/);
    if (policyMatch) {
      const [, chainName, policy] = policyMatch;
      chains.set(chainName, {
        name: chainName,
        policy: policy,
        rules: [],
      });
      continue;
    }

    const rule = parseIptablesRule(trimmed);
    if (rule) {
      let chain = chains.get(rule.chain);
      if (!chain) {
        chain = {
          name: rule.chain,
          policy: "ACCEPT",
          rules: [],
        };
        chains.set(rule.chain, chain);
      }
      chain.rules.push(rule);
    }
  }

  return Array.from(chains.values());
}

function parseNftablesOutput(output: string): FirewallChain[] {
  const chains: FirewallChain[] = [];
  let currentChain: FirewallChain | null = null;

  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    const chainMatch = trimmed.match(
      /chain\s+(\S+)\s*\{?\s*(?:type\s+\S+\s+hook\s+(\S+))?/,
    );
    if (chainMatch) {
      if (currentChain) {
        chains.push(currentChain);
      }
      currentChain = {
        name: chainMatch[1].toUpperCase(),
        policy: "ACCEPT",
        rules: [],
      };
      continue;
    }

    if (currentChain && trimmed.startsWith("policy ")) {
      const policyMatch = trimmed.match(/policy\s+(\S+)/);
      if (policyMatch) {
        currentChain.policy = policyMatch[1].toUpperCase();
      }
      continue;
    }

    if (currentChain && trimmed && !trimmed.startsWith("}")) {
      const rule: FirewallRule = {
        chain: currentChain.name,
        target: "",
        protocol: "all",
        source: "0.0.0.0/0",
        destination: "0.0.0.0/0",
      };

      if (trimmed.includes("accept")) rule.target = "ACCEPT";
      else if (trimmed.includes("drop")) rule.target = "DROP";
      else if (trimmed.includes("reject")) rule.target = "REJECT";

      const tcpMatch = trimmed.match(/tcp\s+dport\s+(\S+)/);
      if (tcpMatch) {
        rule.protocol = "tcp";
        rule.dport = tcpMatch[1];
      }

      const udpMatch = trimmed.match(/udp\s+dport\s+(\S+)/);
      if (udpMatch) {
        rule.protocol = "udp";
        rule.dport = udpMatch[1];
      }

      const saddrMatch = trimmed.match(/saddr\s+(\S+)/);
      if (saddrMatch) {
        rule.source = saddrMatch[1];
      }

      const daddrMatch = trimmed.match(/daddr\s+(\S+)/);
      if (daddrMatch) {
        rule.destination = daddrMatch[1];
      }

      const iifMatch = trimmed.match(/iif\s+"?(\S+)"?/);
      if (iifMatch) {
        rule.interface = iifMatch[1].replace(/"/g, "");
      }

      const ctStateMatch = trimmed.match(/ct\s+state\s+(\S+)/);
      if (ctStateMatch) {
        rule.state = ctStateMatch[1].toUpperCase();
      }

      if (rule.target) {
        currentChain.rules.push(rule);
      }
    }

    if (trimmed === "}") {
      if (currentChain) {
        chains.push(currentChain);
        currentChain = null;
      }
    }
  }

  if (currentChain) {
    chains.push(currentChain);
  }

  return chains;
}

export async function collectFirewallMetrics(
  client: Client,
): Promise<FirewallMetrics> {
  try {
    const iptablesResult = await execCommand(
      client,
      "iptables-save 2>/dev/null",
      15000,
    );

    if (iptablesResult.stdout && iptablesResult.stdout.includes("*filter")) {
      const chains = parseIptablesOutput(iptablesResult.stdout);
      const hasRules = chains.some((c) => c.rules.length > 0);

      return {
        type: "iptables",
        status: hasRules ? "active" : "inactive",
        chains: chains.filter(
          (c) =>
            c.name === "INPUT" || c.name === "OUTPUT" || c.name === "FORWARD",
        ),
      };
    }

    const nftResult = await execCommand(
      client,
      "nft list ruleset 2>/dev/null",
      15000,
    );

    if (nftResult.stdout && nftResult.stdout.trim()) {
      const chains = parseNftablesOutput(nftResult.stdout);
      const hasRules = chains.some((c) => c.rules.length > 0);

      return {
        type: "nftables",
        status: hasRules ? "active" : "inactive",
        chains,
      };
    }

    return {
      type: "none",
      status: "unknown",
      chains: [],
    };
  } catch {
    return {
      type: "none",
      status: "unknown",
      chains: [],
    };
  }
}
