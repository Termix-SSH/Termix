/**
 * LDAP sign-in as a form login method: a service bind to find the user, a
 * bind as the user to check the password, then an optional admin group
 * lookup. Core finds or provisions the user and issues the session.
 */

import ldap from "ldapjs";
import {
  LoginMethodError,
  type PluginContext,
  type PluginLoginRequest,
  type PluginVerifiedIdentity,
} from "@termix/plugin-sdk/backend";
import type { ProviderStore } from "./providers.js";
import type { LdapConfig } from "./types.js";

export const METHOD_ID = "ldap";

export function ldapEscapeFilter(value: string): string {
  return value.replace(
    /[\\*()\x00]/g,
    (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

/** The provider id identities from this directory are stored under. */
export function identityProvider(providerId: number): string {
  return `ldap:${providerId}`;
}

function createClient(config: LdapConfig): ldap.Client {
  const useTLS = !!config.useTLS;
  const url = `${useTLS ? "ldaps" : "ldap"}://${config.host}:${config.port || 389}`;
  return ldap.createClient({
    url,
    tlsOptions: useTLS ? { rejectUnauthorized: false } : undefined,
  });
}

function bind(client: ldap.Client, dn: string, password: string) {
  return new Promise<void>((resolve, reject) => {
    client.bind(dn, password, (err) => (err ? reject(err) : resolve()));
  });
}

function search(
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

function unbind(client: ldap.Client): void {
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

export function createLdapLogin(ctx: PluginContext, store: ProviderStore) {
  return async function verify(
    request: PluginLoginRequest,
    instanceId: string | null,
  ): Promise<PluginVerifiedIdentity> {
    const body = request.body ?? {};
    const providerId = Number(instanceId ?? body.providerId);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!Number.isInteger(providerId) || !username || !password) {
      throw new LoginMethodError(
        "providerId, username, and password are required",
        400,
      );
    }

    // Same limits as password login: an LDAP bind is a password guess.
    const clientIp = request.ip || "unknown";
    const rateLimitKey = `${providerId}:${username}`;
    const lock = await ctx.auth.loginRateLimit.isLocked(clientIp, rateLimitKey);
    if (lock.locked) {
      const error = new LoginMethodError(
        "Too many login attempts. Please try again later.",
        429,
      );
      Object.assign(error, { remainingTime: lock.remainingTime });
      throw error;
    }

    const provider = await store.find(providerId);
    if (!provider || !provider.enabled) {
      throw new LoginMethodError("LDAP provider not found", 404);
    }
    const config = provider.config;
    if (
      !config.host ||
      !config.bindDN ||
      !config.userSearchBase ||
      !config.userSearchFilter
    ) {
      throw new LoginMethodError("LDAP provider is misconfigured", 500);
    }

    const refuse = async (reason: string) => {
      await ctx.auth.loginRateLimit.recordFailure(clientIp, rateLimitKey);
      ctx.log.warn(`LDAP login refused for ${username}: ${reason}`);
      return new LoginMethodError("Invalid username or password", 401);
    };

    const serviceClient = createClient(config);
    try {
      await bind(serviceClient, config.bindDN, config.bindPassword);

      const filter = config.userSearchFilter.replace(
        /\{\{username\}\}/g,
        ldapEscapeFilter(username),
      );
      const entries = await search(
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
      if (entries.length === 0) throw await refuse("user not found");

      const userEntry = entries[0];
      const userDN = userEntry.dn.toString();
      const uid =
        firstValue(userEntry, config.usernameAttribute || "uid") || username;
      const displayName =
        firstValue(userEntry, config.displayNameAttribute || "cn") || username;
      const email =
        firstValue(userEntry, "mail") || firstValue(userEntry, "email") || "";

      const userClient = createClient(config);
      try {
        await bind(userClient, userDN, password);
      } catch {
        throw await refuse("wrong password");
      } finally {
        unbind(userClient);
      }

      let isAdmin: boolean | undefined;
      if (config.adminGroup && config.groupSearchBase) {
        isAdmin = false;
        try {
          const groups = await search(
            serviceClient,
            config.groupSearchBase,
            `(member=${ldapEscapeFilter(userDN)})`,
            ["cn", "dn"],
          );
          isAdmin = groups.some(
            (group) =>
              firstValue(group, "cn") === config.adminGroup ||
              group.dn.toString() === config.adminGroup,
          );
        } catch (error) {
          ctx.log.warn(`LDAP group check failed: ${String(error)}`);
        }
      }

      return {
        kind: "external",
        provider: identityProvider(providerId),
        subject: uid,
        email: email || null,
        name: displayName,
        isAdmin,
        allowedUsers: config.allowedUsers ?? null,
        legacy: {
          identifier: `ldap:${providerId}:${uid}`,
          providerRowId: providerId,
        },
        rememberMe: !!body.rememberMe,
        rateLimitKey,
      };
    } finally {
      unbind(serviceClient);
    }
  };
}
