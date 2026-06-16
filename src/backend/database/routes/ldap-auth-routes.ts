import type { Router } from "express";
import type { LDAPProviderConfig } from "../../../types/index.js";
import { db } from "../db/index.js";
import { ssoProviders, users, roles, userRoles } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { parseUserAgent } from "../../utils/user-agent-parser.js";
import { isOIDCUserAllowed, loadProviderConfig } from "./user-oidc-utils.js";
import ldap from "ldapjs";

const authManager = AuthManager.getInstance();

function ldapEscapeFilter(value: string): string {
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
    /* best effort */
  }
}

export function registerLDAPAuthRoutes(router: Router): void {
  /**
   * @openapi
   * /users/ldap/login:
   *   post:
   *     summary: LDAP login
   *     description: Authenticates a user against an LDAP server.
   *     tags:
   *       - SSO
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               providerId:
   *                 type: integer
   *               username:
   *                 type: string
   *               password:
   *                 type: string
   *               rememberMe:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Login successful.
   *       400:
   *         description: Missing fields.
   *       401:
   *         description: Invalid credentials.
   *       403:
   *         description: User not allowed.
   *       404:
   *         description: Provider not found.
   */
  router.post("/ldap/login", async (req, res) => {
    const { providerId, username, password, rememberMe } = req.body as {
      providerId: number;
      username: string;
      password: string;
      rememberMe?: boolean;
    };

    if (!providerId || !username || !password) {
      return res
        .status(400)
        .json({ error: "providerId, username, and password are required" });
    }

    try {
      const rows = await db
        .select()
        .from(ssoProviders)
        .where(eq(ssoProviders.id, providerId))
        .limit(1);
      if (rows.length === 0 || rows[0].type !== "ldap" || !rows[0].enabled) {
        return res.status(404).json({ error: "LDAP provider not found" });
      }
    } catch (err) {
      authLogger.error("Failed to load LDAP provider", err);
      return res.status(500).json({ error: "Failed to load LDAP provider" });
    }

    const providerResult = await loadProviderConfig(providerId);
    if (!providerResult) {
      return res.status(404).json({ error: "LDAP provider not found" });
    }
    const config = providerResult.config as unknown as LDAPProviderConfig;

    if (
      !config.host ||
      !config.bindDN ||
      !config.userSearchBase ||
      !config.userSearchFilter
    ) {
      return res.status(500).json({ error: "LDAP provider is misconfigured" });
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
      const attrList = [
        config.usernameAttribute || "uid",
        config.displayNameAttribute || "cn",
        "mail",
        "email",
      ];
      const entries = await ldapSearch(
        serviceClient,
        config.userSearchBase,
        filter,
        attrList,
      );

      if (entries.length === 0) {
        authLogger.warn("LDAP user not found", {
          operation: "ldap_login",
          username,
        });
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const userEntry = entries[0];
      const userDN = userEntry.dn.toString();

      const getAttr = (key: string): string => {
        const attr = userEntry.attributes.find((a) => a.type === key);
        return attr
          ? Array.isArray(attr.values)
            ? attr.values[0]
            : String(attr.values)
          : "";
      };

      const ldapIdentifier =
        getAttr(config.usernameAttribute || "uid") || username;
      const displayName =
        getAttr(config.displayNameAttribute || "cn") || username;
      const email = getAttr("mail") || getAttr("email") || "";

      if (config.allowedUsers) {
        if (
          !isOIDCUserAllowed(
            config.allowedUsers,
            ldapIdentifier,
            email || undefined,
          )
        ) {
          authLogger.warn("LDAP user not in allowed list", {
            operation: "ldap_user_not_allowed",
            ldapIdentifier,
          });
          return res.status(403).json({ error: "User not allowed" });
        }
      }

      // Re-bind with user's own credentials to verify password
      const userClient = createLDAPClient(
        config.host,
        config.port || 389,
        config.useTLS || false,
      );
      try {
        await ldapBind(userClient, userDN, password);
      } catch {
        authLogger.warn("LDAP bind failed - wrong password", {
          operation: "ldap_login",
          ldapIdentifier,
        });
        return res.status(401).json({ error: "Invalid username or password" });
      } finally {
        ldapUnbind(userClient);
      }

      // Admin group check
      let isAdmin = false;
      if (config.adminGroup && config.groupSearchBase) {
        try {
          const groupFilter = `(member=${ldapEscapeFilter(userDN)})`;
          const groupEntries = await ldapSearch(
            serviceClient,
            config.groupSearchBase,
            groupFilter,
            ["cn", "dn"],
          );
          isAdmin = groupEntries.some((g) => {
            const cn = g.attributes.find((a) => a.type === "cn");
            const cnVal = cn
              ? Array.isArray(cn.values)
                ? cn.values[0]
                : String(cn.values)
              : "";
            return (
              cnVal === config.adminGroup ||
              g.dn.toString() === config.adminGroup
            );
          });
        } catch (groupErr) {
          authLogger.warn("LDAP group check failed", {
            operation: "ldap_group_check",
            error: groupErr,
          });
        }
      }

      ldapUnbind(serviceClient);

      const deviceInfo = parseUserAgent(req);
      const oidcIdentifier = `ldap:${providerId}:${ldapIdentifier}`;

      let existingUsers = await db
        .select()
        .from(users)
        .where(eq(users.oidcIdentifier, oidcIdentifier));

      let userId: string;
      if (existingUsers.length === 0) {
        let autoProvision = false;
        try {
          const r = db.$client
            .prepare(
              "SELECT value FROM settings WHERE key = 'oidc_auto_provision'",
            )
            .get() as { value: string } | undefined;
          if (r) autoProvision = r.value === "true";
        } catch {
          /* */
        }
        if (!autoProvision)
          autoProvision =
            (process.env.OIDC_ALLOW_REGISTRATION || "").trim().toLowerCase() ===
            "true";

        const countRow = db.$client
          .prepare("SELECT COUNT(*) as count FROM users")
          .get() as { count?: number };
        const isFirst = (countRow?.count || 0) === 0;

        if (!isFirst && !autoProvision) {
          const regRow = db.$client
            .prepare(
              "SELECT value FROM settings WHERE key = 'allow_registration'",
            )
            .get() as { value: string } | undefined;
          if (regRow && regRow.value !== "true") {
            return res.status(403).json({ error: "Registration is disabled" });
          }
        }

        userId = nanoid();
        const isFirstFinal = db.$client.transaction(() => {
          const c =
            (
              db.$client
                .prepare("SELECT COUNT(*) as count FROM users")
                .get() as { count?: number }
            )?.count || 0;
          const first = c === 0;
          db.$client
            .prepare(
              "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, oidc_identifier, sso_provider_id) VALUES (?, ?, ?, ?, 1, ?, ?)",
            )
            .run(
              userId,
              displayName,
              "",
              first || isAdmin ? 1 : 0,
              oidcIdentifier,
              providerId,
            );
          return first;
        })();

        try {
          const defaultRoleName = isFirstFinal || isAdmin ? "admin" : "user";
          const defaultRole = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, defaultRoleName))
            .limit(1);
          if (defaultRole.length > 0)
            await db
              .insert(userRoles)
              .values({ userId, roleId: defaultRole[0].id, grantedBy: userId });
        } catch {
          /* */
        }

        try {
          const sessionDurationMs =
            deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
              ? 30 * 24 * 60 * 60 * 1000
              : 24 * 60 * 60 * 1000;
          await authManager.registerOIDCUser(userId, sessionDurationMs);
        } catch (encryptionError) {
          await db.delete(users).where(eq(users.id, userId));
          authLogger.error(
            "Failed to setup LDAP user encryption",
            encryptionError,
          );
          return res
            .status(500)
            .json({ error: "Failed to setup user security" });
        }

        existingUsers = await db
          .select()
          .from(users)
          .where(eq(users.id, userId));
      } else {
        userId = existingUsers[0].id;

        // Sync admin status from group membership
        if (config.adminGroup && !!existingUsers[0].isAdmin !== isAdmin) {
          await db.update(users).set({ isAdmin }).where(eq(users.id, userId));
          existingUsers[0].isAdmin = isAdmin;
        }

        // Update display name if not dual-auth
        const isDualAuth =
          existingUsers[0].passwordHash &&
          existingUsers[0].passwordHash.trim() !== "";
        if (!isDualAuth && existingUsers[0].username !== displayName) {
          await db
            .update(users)
            .set({ username: displayName })
            .where(eq(users.id, userId));
        }
      }

      const userRecord = existingUsers[0];
      try {
        await authManager.authenticateOIDCUser(userRecord.id, deviceInfo.type);
      } catch {
        /* */
      }

      const token = await authManager.generateJWTToken(userRecord.id, {
        deviceType: deviceInfo.type,
        deviceInfo: deviceInfo.deviceInfo,
        rememberMe: rememberMe || false,
      });

      authLogger.success("LDAP login successful", {
        operation: "ldap_login_complete",
        userId: userRecord.id,
        username: userRecord.username,
      });

      const maxAge =
        deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
          ? 30 * 24 * 60 * 60 * 1000
          : rememberMe
            ? 30 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

      res.clearCookie("jwt", authManager.getClearCookieOptions(req));
      return res
        .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
        .json({ success: true, message: "Login successful" });
    } catch (err) {
      ldapUnbind(serviceClient);
      authLogger.error("LDAP login failed", err);
      return res.status(500).json({ error: "LDAP authentication failed" });
    }
  });
}
