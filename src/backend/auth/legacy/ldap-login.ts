/**
 * LDAP sign-in as a form login method. Moved out of the LDAP route so the
 * pipeline issues the session; Phase C moves it into the LDAP plugin.
 */

import ldap from "ldapjs";
import type { LDAPProviderConfig } from "../../../types/index.js";
import { authLogger } from "../../utils/logger.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import { createCurrentSsoProviderRepository } from "../../database/repositories/factory.js";
import { loadProviderConfig } from "../../database/routes/user-oidc-utils.js";
import { LoginMethodError, type VerifiedIdentity } from "../types.js";

export function ldapEscapeFilter(value: string): string {
  return value.replace(
    /[\\*()\x00]/g,
    (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

function createLDAPClient(
  host: string,
  port: number,
  useTLS: boolean,
): ldap.Client {
  const url = `${useTLS ? "ldaps" : "ldap"}://${host}:${port}`;
  return ldap.createClient({
    url,
    tlsOptions: useTLS ? { rejectUnauthorized: false } : undefined,
  });
}

function ldapBind(
  client: ldap.Client,
  dn: string,
  password: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function ldapSearch(
  client: ldap.Client,
  base: string,
  filter: string,
  attributes: string[],
): Promise<ldap.SearchEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ldap.SearchEntry[] = [];
    client.search(base, { filter, attributes, scope: "sub" }, (err, res) => {
      if (err) return reject(err);
      res.on("searchEntry", (entry) => entries.push(entry));
      res.on("error", reject);
      res.on("end", () => resolve(entries));
    });
  });
}

function ldapUnbind(client: ldap.Client): void {
  try {
    client.unbind();
  } catch {
    // best effort
  }
}

function firstValue(entry: ldap.SearchEntry, key: string): string {
  const attr = entry.attributes.find((a) => a.type === key);
  if (!attr) return "";
  return Array.isArray(attr.values) ? attr.values[0] : String(attr.values);
}

export async function verifyLdapLogin(request: {
  body: Record<string, unknown>;
  ip?: string;
}): Promise<VerifiedIdentity> {
  const { providerId, username, password, rememberMe } = request.body as {
    providerId?: number;
    username?: string;
    password?: string;
    rememberMe?: boolean;
  };

  if (!providerId || !username || !password) {
    throw new LoginMethodError(
      "providerId, username, and password are required",
      400,
    );
  }

  // Same limits as password login: an LDAP bind is a password guess.
  const clientIp = request.ip || "unknown";
  const rateLimitKey = `ldap:${providerId}:${username}`;
  const lockStatus = loginRateLimiter.isLocked(clientIp, rateLimitKey);
  if (lockStatus.locked) {
    const error = new LoginMethodError(
      "Too many login attempts. Please try again later.",
      429,
    );
    Object.assign(error, { remainingTime: lockStatus.remainingTime });
    throw error;
  }

  const provider =
    await createCurrentSsoProviderRepository().findById(providerId);
  if (!provider || provider.type !== "ldap" || !provider.enabled) {
    throw new LoginMethodError("LDAP provider not found", 404);
  }

  const providerResult = await loadProviderConfig(providerId);
  if (!providerResult) {
    throw new LoginMethodError("LDAP provider not found", 404);
  }
  const config = providerResult.config as unknown as LDAPProviderConfig;
  if (
    !config.host ||
    !config.bindDN ||
    !config.userSearchBase ||
    !config.userSearchFilter
  ) {
    throw new LoginMethodError("LDAP provider is misconfigured", 500);
  }

  const serviceClient = createLDAPClient(
    config.host,
    config.port || 389,
    config.useTLS || false,
  );
  try {
    await ldapBind(serviceClient, config.bindDN, config.bindPassword);

    const filter = config.userSearchFilter.replace(
      /\{\{username\}\}/g,
      ldapEscapeFilter(username),
    );
    const entries = await ldapSearch(
      serviceClient,
      config.userSearchBase,
      filter,
      [
        config.usernameAttribute || "uid",
        config.displayNameAttribute || "cn",
        "mail",
        "email",
      ],
    );

    if (entries.length === 0) {
      loginRateLimiter.recordFailedAttempt(clientIp, rateLimitKey);
      authLogger.warn("LDAP user not found", {
        operation: "ldap_login",
        username,
      });
      throw new LoginMethodError("Invalid username or password", 401);
    }

    const userEntry = entries[0];
    const userDN = userEntry.dn.toString();
    const ldapIdentifier =
      firstValue(userEntry, config.usernameAttribute || "uid") || username;
    const displayName =
      firstValue(userEntry, config.displayNameAttribute || "cn") || username;
    const email =
      firstValue(userEntry, "mail") || firstValue(userEntry, "email") || "";

    const userClient = createLDAPClient(
      config.host,
      config.port || 389,
      config.useTLS || false,
    );
    try {
      await ldapBind(userClient, userDN, password);
    } catch {
      loginRateLimiter.recordFailedAttempt(clientIp, rateLimitKey);
      authLogger.warn("LDAP bind failed - wrong password", {
        operation: "ldap_login",
        ldapIdentifier,
      });
      throw new LoginMethodError("Invalid username or password", 401);
    } finally {
      ldapUnbind(userClient);
    }

    let isAdmin: boolean | undefined;
    if (config.adminGroup && config.groupSearchBase) {
      isAdmin = false;
      try {
        const groupEntries = await ldapSearch(
          serviceClient,
          config.groupSearchBase,
          `(member=${ldapEscapeFilter(userDN)})`,
          ["cn", "dn"],
        );
        isAdmin = groupEntries.some(
          (group) =>
            firstValue(group, "cn") === config.adminGroup ||
            group.dn.toString() === config.adminGroup,
        );
      } catch (groupErr) {
        authLogger.warn("LDAP group check failed", {
          operation: "ldap_group_check",
          error: groupErr,
        });
      }
    }

    return {
      kind: "external",
      provider: String(providerId),
      subject: ldapIdentifier,
      email: email || null,
      name: displayName,
      isAdmin,
      allowedUsers: config.allowedUsers ?? null,
      legacyIdentifier: `ldap:${providerId}:${ldapIdentifier}`,
      ssoProviderId: providerId,
      rememberMe: !!rememberMe,
      rateLimitUsername: rateLimitKey,
    };
  } finally {
    ldapUnbind(serviceClient);
  }
}
