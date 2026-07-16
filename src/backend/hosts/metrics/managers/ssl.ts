import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated, shellSingleQuote } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import {
  isValidDomain,
  isValidDnsProvider,
  isAllowedPath,
} from "./validation.js";
import { detectPlatform } from "./platform.js";
import type { ManagerRoutesDeps } from "./types.js";

export type AcmeClient = "certbot" | "acme.sh";
export type ChallengeType = "http-standalone" | "http-webroot" | "dns";

export interface CertInfo {
  client: AcmeClient | "other";
  name: string;
  domains: string[];
  expiry: string | null;
  path?: string;
}

const CERTBOT_LIST_CMD = "certbot certificates 2>/dev/null";
const ACMESH_BIN = '"$(command -v acme.sh || echo "$HOME/.acme.sh/acme.sh")"';
const ACMESH_LIST_CMD = `${ACMESH_BIN} --list 2>/dev/null`;

/** Parse `certbot certificates` output. */
export function parseCertbotCertificates(output: string): CertInfo[] {
  const certs: CertInfo[] = [];
  let current: CertInfo | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const nameM = line.match(/^Certificate Name:\s+(.+)$/);
    if (nameM) {
      if (current) certs.push(current);
      current = {
        client: "certbot",
        name: nameM[1],
        domains: [],
        expiry: null,
      };
      continue;
    }
    if (!current) continue;
    const domM = line.match(/^Domains:\s+(.+)$/);
    if (domM) current.domains = domM[1].split(/\s+/).filter(Boolean);
    const expM = line.match(/^Expiry Date:\s+(\S+\s+\S+)/);
    if (expM) current.expiry = expM[1];
    const pathM = line.match(/^Certificate Path:\s+(.+)$/);
    if (pathM) current.path = pathM[1];
  }
  if (current) certs.push(current);
  return certs;
}

/** Parse `acme.sh --list` (tab/space separated columns with a header). */
export function parseAcmeShList(output: string): CertInfo[] {
  const certs: CertInfo[] = [];
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return certs;
  for (const line of lines.slice(1)) {
    const cols = line
      .split(/\s{2,}|\t/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 1) continue;
    certs.push({
      client: "acme.sh",
      name: cols[0],
      domains: [cols[0]],
      expiry: cols[cols.length - 1] || null,
    });
  }
  return certs;
}

/**
 * A certbot cert name or acme.sh primary domain. Allows letters, digits, dots,
 * hyphens, underscores and the wildcard `*` (acme.sh), but no shell metachars.
 */
const CERT_NAME_RE = /^[A-Za-z0-9._*-]+$/;
export function isValidCertName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && CERT_NAME_RE.test(name);
}

export interface IssueRequest {
  client: AcmeClient;
  domains: string[];
  challenge: ChallengeType;
  webroot?: string;
  dnsProvider?: string;
}

/**
 * Build the certificate issuance command for the chosen client/challenge.
 * DNS-01 provider credentials are expected to already be present in the
 * environment / provider config file; we never put secrets in argv.
 */
export function buildIssueCommand(req: IssueRequest): string {
  const domains = req.domains;
  if (req.client === "certbot") {
    const dFlags = domains.map((d) => `-d ${shellSingleQuote(d)}`).join(" ");
    if (req.challenge === "dns") {
      return `certbot certonly --non-interactive --agree-tos --dns-${req.dnsProvider} ${dFlags}`;
    }
    if (req.challenge === "http-webroot") {
      return `certbot certonly --non-interactive --agree-tos --webroot -w ${shellSingleQuote(
        req.webroot as string,
      )} ${dFlags}`;
    }
    return `certbot certonly --non-interactive --agree-tos --standalone ${dFlags}`;
  }
  // acme.sh
  const dFlags = domains.map((d) => `-d ${shellSingleQuote(d)}`).join(" ");
  if (req.challenge === "dns") {
    return `${ACMESH_BIN} --issue --dns dns_${req.dnsProvider} ${dFlags}`;
  }
  if (req.challenge === "http-webroot") {
    return `${ACMESH_BIN} --issue -w ${shellSingleQuote(
      req.webroot as string,
    )} ${dFlags}`;
  }
  return `${ACMESH_BIN} --issue --standalone ${dFlags}`;
}

export function buildRenewCommand(client: AcmeClient, dryRun: boolean): string {
  if (client === "certbot") {
    return `certbot renew${dryRun ? " --dry-run" : ""}`;
  }
  return `${ACMESH_BIN} --renew-all${dryRun ? " --staging" : ""}`;
}

/**
 * Revoke (and remove) a certificate. certbot revokes by its certificate name and
 * deletes the lineage afterwards; acme.sh revokes by primary domain then removes
 * it from management. `name` is the certbot cert name or the acme.sh domain.
 */
export function buildRevokeCommand(client: AcmeClient, name: string): string {
  if (client === "certbot") {
    return `certbot revoke --non-interactive --cert-name ${shellSingleQuote(
      name,
    )} --delete-after-revoke`;
  }
  const d = shellSingleQuote(name);
  return `${ACMESH_BIN} --revoke -d ${d} && ${ACMESH_BIN} --remove -d ${d}`;
}

export function registerSslRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/ssl/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "ssl_list", async (client, host) => {
      const platform = await detectPlatform(client);
      const certs: CertInfo[] = [];
      if (platform.hasCertbot) {
        const r = await execElevated(
          client,
          CERTBOT_LIST_CMD,
          host.sudoPassword,
        ).catch(() => null);
        if (r) certs.push(...parseCertbotCertificates(r.stdout));
      }
      if (platform.hasAcmeSh) {
        const { stdout } = await execCommand(
          client,
          ACMESH_LIST_CMD,
          15000,
        ).catch(() => ({ stdout: "" }) as { stdout: string });
        certs.push(...parseAcmeShList(stdout));
      }
      return {
        clients: {
          certbot: platform.hasCertbot,
          acmeSh: platform.hasAcmeSh,
        },
        certs,
      };
    }),
  );

  app.post(
    "/host-metrics/managers/ssl/:id/issue",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "ssl_issue",
      async (client, host, req) => {
        const body = req.body as Partial<IssueRequest>;
        if (body.client !== "certbot" && body.client !== "acme.sh") {
          throw new ManagerInputError("Invalid ACME client");
        }
        if (!Array.isArray(body.domains) || body.domains.length === 0) {
          throw new ManagerInputError("At least one domain is required");
        }
        for (const d of body.domains) {
          if (!isValidDomain(d))
            throw new ManagerInputError(`Invalid domain: ${d}`);
        }
        const challenge = body.challenge;
        if (
          challenge !== "http-standalone" &&
          challenge !== "http-webroot" &&
          challenge !== "dns"
        ) {
          throw new ManagerInputError("Invalid challenge type");
        }
        if (challenge === "dns" && !isValidDnsProvider(body.dnsProvider)) {
          throw new ManagerInputError("Invalid DNS provider");
        }
        if (
          challenge === "http-webroot" &&
          !isAllowedPath(body.webroot, ["/var/www", "/srv", "/usr/share/nginx"])
        ) {
          throw new ManagerInputError("Invalid or disallowed webroot path");
        }
        const cmd = buildIssueCommand(body as IssueRequest);
        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
          timeoutMs: 300000,
        });
        return {
          success: result.code === 0,
          output: (result.stdout || result.stderr).slice(-8000),
        };
      },
    ),
  );

  app.post(
    "/host-metrics/managers/ssl/:id/renew",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "ssl_renew",
      async (client, host, req) => {
        const { client: acmeClient, dryRun } = req.body as {
          client?: AcmeClient;
          dryRun?: boolean;
        };
        if (acmeClient !== "certbot" && acmeClient !== "acme.sh") {
          throw new ManagerInputError("Invalid ACME client");
        }
        const cmd = buildRenewCommand(acmeClient, !!dryRun);
        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
          timeoutMs: 300000,
        });
        return {
          success: result.code === 0,
          output: (result.stdout || result.stderr).slice(-8000),
        };
      },
    ),
  );

  /**
   * @openapi
   * /host-metrics/managers/ssl/{id}/revoke:
   *   post:
   *     summary: Revoke and remove an issued certificate (certbot or acme.sh)
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               client: { type: string, enum: [certbot, acme.sh] }
   *               name: { type: string, description: certbot cert name or acme.sh domain }
   *     responses:
   *       200: { description: Revoke result. }
   *       400: { description: Invalid client or certificate name. }
   *       403: { description: Elevation required or denied. }
   */
  app.post(
    "/host-metrics/managers/ssl/:id/revoke",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "ssl_revoke",
      async (client, host, req) => {
        const { client: acmeClient, name } = req.body as {
          client?: AcmeClient;
          name?: string;
        };
        if (acmeClient !== "certbot" && acmeClient !== "acme.sh") {
          throw new ManagerInputError("Invalid ACME client");
        }
        if (!isValidCertName(name)) {
          throw new ManagerInputError("Invalid certificate name");
        }
        const cmd = buildRevokeCommand(acmeClient, name);
        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
          timeoutMs: 120000,
        });
        return {
          success: result.code === 0,
          output: (result.stdout || result.stderr).slice(-8000),
        };
      },
    ),
  );
}
