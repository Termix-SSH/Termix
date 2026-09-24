import { vi } from "vitest";

export interface FakeUser {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  isOidc: boolean;
  oidcIdentifier?: string | null;
  ssoProviderId?: number | null;
}

/** In-memory stand-ins for the repositories the login pipeline touches. */
export function createAuthState() {
  return {
    users: new Map<string, FakeUser>(),
    identities: [] as Array<{
      id: number;
      userId: string;
      providerId: string;
      subject: string;
      email: string | null;
    }>,
    factors: [] as Array<{
      userId: string;
      pluginId: string;
      factorId: string;
    }>,
    roles: [] as Array<{ userId: string; roleName: string }>,
    settings: new Map<string, string>(),
    audits: [] as Array<Record<string, unknown>>,
    trusted: new Set<string>(),
    trustedAdded: [] as string[],
    pendingTokens: new Map<string, string>(),
  };
}

export type AuthState = ReturnType<typeof createAuthState>;

export function fakeFactory(state: AuthState) {
  return {
    createCurrentUserRepository: () => ({
      findById: async (id: string) => state.users.get(id) ?? null,
      findByUsername: async (username: string) =>
        [...state.users.values()].find((u) => u.username === username) ?? null,
      findByOidcIdentifier: async (identifier: string) =>
        [...state.users.values()].find(
          (u) => u.oidcIdentifier === identifier,
        ) ?? null,
      countAll: async () => state.users.size,
      listAll: async () => [...state.users.values()],
      createFirstSsoUser: async (user: FakeUser) => {
        const isFirstUser = state.users.size === 0;
        const created = {
          ...user,
          isAdmin: isFirstUser || !!user.isAdmin,
        };
        state.users.set(user.id, created);
        return { user: created, isFirstUser };
      },
      update: async (id: string, changes: Partial<FakeUser>) => {
        const user = state.users.get(id);
        if (!user) return null;
        Object.assign(user, changes);
        return user;
      },
      delete: async (id: string) => state.users.delete(id),
    }),
    createCurrentUserAuthRepository: () => ({
      findIdentity: async (providerId: string, subject: string) =>
        state.identities.find(
          (row) => row.providerId === providerId && row.subject === subject,
        ) ?? null,
      linkIdentity: async (input: {
        userId: string;
        providerId: string;
        subject: string;
        email?: string | null;
      }) => {
        const existing = state.identities.find(
          (row) =>
            row.providerId === input.providerId &&
            row.subject === input.subject,
        );
        if (existing) {
          existing.userId = input.userId;
          return;
        }
        state.identities.push({
          id: state.identities.length + 1,
          userId: input.userId,
          providerId: input.providerId,
          subject: input.subject,
          email: input.email ?? null,
        });
      },
      countUsersForProvider: async (providerId: string) =>
        new Set(
          state.identities
            .filter((row) => row.providerId === providerId)
            .map((row) => row.userId),
        ).size,
      listSecondFactors: async (userId: string) =>
        state.factors.filter((row) => row.userId === userId),
      hasSecondFactor: async (userId: string) =>
        state.factors.some((row) => row.userId === userId),
      listUserIdsWithSecondFactors: async () =>
        new Set(state.factors.map((row) => row.userId)),
      countUsersWithSecondFactors: async () =>
        new Set(state.factors.map((row) => row.userId)).size,
      recordSecondFactor: async (
        userId: string,
        pluginId: string,
        factorId: string,
      ) => {
        if (
          !state.factors.some(
            (row) =>
              row.userId === userId &&
              row.pluginId === pluginId &&
              row.factorId === factorId,
          )
        ) {
          state.factors.push({ userId, pluginId, factorId });
        }
      },
      removeSecondFactor: async (
        userId: string,
        pluginId: string,
        factorId: string,
      ) => {
        state.factors = state.factors.filter(
          (row) =>
            !(
              row.userId === userId &&
              row.pluginId === pluginId &&
              row.factorId === factorId
            ),
        );
        return true;
      },
      clearSecondFactors: async (userId: string) => {
        state.factors = state.factors.filter((row) => row.userId !== userId);
        return 1;
      },
    }),
    createCurrentRoleRepository: () => ({
      assignRoleNameToUser: async (input: {
        userId: string;
        roleName: string;
      }) => {
        state.roles.push({ userId: input.userId, roleName: input.roleName });
        return true;
      },
      switchUserRoleName: async (input: {
        userId: string;
        addRoleName: string;
        removeRoleName: string;
      }) => {
        state.roles = state.roles.filter(
          (role) =>
            !(
              role.userId === input.userId &&
              role.roleName === input.removeRoleName
            ),
        );
        state.roles.push({ userId: input.userId, roleName: input.addRoleName });
      },
      listUserRoles: async (userId: string) =>
        state.roles
          .filter((role) => role.userId === userId)
          .map((role, index) => ({ roleId: index, roleName: role.roleName })),
      removeRoleFromUser: async () => true,
    }),
    createCurrentSettingsRepository: () => ({
      get: async (key: string) => state.settings.get(key) ?? null,
      getBoolean: async (key: string, fallback: boolean) =>
        state.settings.has(key) ? state.settings.get(key) === "true" : fallback,
      set: async (key: string, value: string) => {
        state.settings.set(key, value);
      },
      delete: async (key: string) => state.settings.delete(key),
    }),
    getCurrentSettingValue: (key: string) => state.settings.get(key) ?? null,
    createCurrentTrustedDeviceRepository: () => ({
      deleteByUserId: async () => {},
    }),
  };
}

export function fakeAuthManager(state: AuthState) {
  let tokenCount = 0;
  return {
    generateJWTToken: vi.fn(
      async (userId: string, options: { pendingTOTP?: boolean } = {}) => {
        if (!options.pendingTOTP) return `jwt-${++tokenCount}`;
        const token = `pending-${++tokenCount}`;
        state.pendingTokens.set(token, userId);
        return token;
      },
    ),
    verifyJWTToken: vi.fn(async (token: string) => {
      const userId = state.pendingTokens.get(token);
      return userId ? { userId, pendingTOTP: true } : null;
    }),
    authenticateUser: vi.fn(async () => true),
    authenticateOIDCUser: vi.fn(async () => true),
    revokeSessionsByOidc: vi.fn(async () => 1),
    unlockWithSystemKey: vi.fn(async () => true),
    registerOIDCUser: vi.fn(async () => {}),
    isTrustedDevice: vi.fn(async (userId: string, fingerprint: string) =>
      state.trusted.has(`${userId}:${fingerprint}`),
    ),
    addTrustedDevice: vi.fn(async (userId: string, fingerprint: string) => {
      state.trustedAdded.push(`${userId}:${fingerprint}`);
    }),
    getSecureCookieOptions: vi.fn((_req: unknown, maxAge: number) => ({
      httpOnly: true,
      maxAge,
    })),
    getClearCookieOptions: vi.fn(() => ({ httpOnly: true })),
    getUserDataKey: vi.fn(() => Buffer.alloc(32, 7)),
  };
}

export function fakeRequest(overrides: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0",
    "x-termix-device-id": "a".repeat(64),
    ...(overrides.headers as Record<string, string> | undefined),
  };
  return {
    body: {},
    query: {},
    params: {},
    cookies: {},
    ip: "10.0.0.1",
    socket: { remoteAddress: "10.0.0.1" },
    ...overrides,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as Record<string, unknown> & { headers: Record<string, string> };
}

export function fakeResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: [] as Array<{ name: string; value: string; options: unknown }>,
    cleared: [] as string[],
    redirectedTo: null as string | null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    cookie(name: string, value: string, options: unknown) {
      res.cookies.push({ name, value, options });
      return res;
    },
    clearCookie(name: string) {
      res.cleared.push(name);
      return res;
    },
    redirect(url: string) {
      res.redirectedTo = url;
      return res;
    },
  };
  return res;
}
