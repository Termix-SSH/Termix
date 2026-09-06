import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings[key] ?? null,
    set: async (key: string, value: string) => {
      state.settings[key] = value;
    },
    setMany: async (writes: Array<{ key: string; value: string }>) => {
      for (const write of writes) state.settings[write.key] = write.value;
    },
    delete: async (key: string) => {
      delete state.settings[key];
    },
  }),
}));

const { registerBrandingRoutes } =
  await import("../../../database/routes/branding-routes.js");

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

/** Runs a route's full middleware chain (e.g. requireAdmin, then the handler). */
function handlersFor(
  router: express.Router,
  pathName: string,
  method: string,
): RequestHandler[] {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (candidate) =>
      candidate.route?.path === pathName && candidate.route.methods[method],
  );
  if (!layer) throw new Error(`Route not registered: ${method} ${pathName}`);
  return layer.route!.stack.map((entry) => entry.handle);
}

async function invokeChain(
  handlers: RequestHandler[],
  body: unknown = {},
): Promise<{ statusCode: number; body: unknown }> {
  const req = { body, headers: {} } as unknown as Request;
  const result = { statusCode: 200, body: null as unknown };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      result.body = payload;
      return this;
    },
  } as unknown as Response;

  for (const handler of handlers) {
    let proceeded = false;
    await handler(req, res, ((err?: unknown) => {
      if (err) throw err;
      proceeded = true;
    }) as NextFunction);
    if (!proceeded) return result;
  }
  return result;
}

/** Mimics the real requireAdmin: 401 with no session, 403 for a non-admin. */
function fakeRequireAdmin(
  outcome: "unauthenticated" | "not-admin" | "admin",
): RequestHandler {
  return (_req, res, next) => {
    if (outcome === "unauthenticated") {
      res.status(401).json({ error: "Missing authentication token" });
      return;
    }
    if (outcome === "not-admin") {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    // Must return (not just call) next() so invokeChain's await actually
    // waits for the downstream async handler to finish before returning.
    return next();
  };
}

function buildRouter(requireAdmin: RequestHandler) {
  const router = express.Router();
  registerBrandingRoutes(router, requireAdmin);
  return router;
}

let pngDataUrl: string;

beforeAll(async () => {
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#112233" },
  })
    .png()
    .toBuffer();
  pngDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
});

beforeEach(() => {
  state.settings = {};
});

describe("GET /users/branding", () => {
  it("succeeds with no auth at all, since the route registers no auth handler", async () => {
    // requireAdmin is only ever wired onto PATCH below; GET's own handler chain
    // has exactly one entry, proving the public route never runs an admin gate.
    const router = buildRouter(fakeRequireAdmin("unauthenticated"));
    const handlers = handlersFor(router, "/branding", "get");
    expect(handlers).toHaveLength(1);

    const response = await invokeChain(handlers);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      appName: "Termix",
      tagline: "",
      logo: null,
    });
  });

  it("reflects persisted branding values", async () => {
    state.settings.branding_app_name = "Acme Ops";
    state.settings.branding_tagline = "Ship it";
    state.settings.branding_logo = pngDataUrl;
    const router = buildRouter(fakeRequireAdmin("admin"));

    const response = await invokeChain(handlersFor(router, "/branding", "get"));

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      appName: "Acme Ops",
      tagline: "Ship it",
      logo: pngDataUrl,
    });
  });
});

describe("PATCH /users/branding", () => {
  it("rejects an unauthenticated request and persists nothing", async () => {
    const router = buildRouter(fakeRequireAdmin("unauthenticated"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      { appName: "Hijacked" },
    );

    expect(response.statusCode).toBe(401);
    expect(state.settings).toEqual({});
  });

  it("rejects a non-admin request and persists nothing", async () => {
    const router = buildRouter(fakeRequireAdmin("not-admin"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      { appName: "Hijacked" },
    );

    expect(response.statusCode).toBe(403);
    expect(state.settings).toEqual({});
  });

  it("persists only the allowed fields for an admin request", async () => {
    const router = buildRouter(fakeRequireAdmin("admin"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      { appName: "Acme Ops", tagline: "Ship it", logo: pngDataUrl },
    );

    expect(response.statusCode).toBe(200);
    expect(state.settings.branding_app_name).toBe("Acme Ops");
    expect(state.settings.branding_tagline).toBe("Ship it");
    expect(state.settings.branding_logo).toMatch(/^data:image\/png;base64,/);
    expect(response.body).toMatchObject({
      appName: "Acme Ops",
      tagline: "Ship it",
    });
  });

  it("rejects unknown fields without writing anything", async () => {
    const router = buildRouter(fakeRequireAdmin("admin"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      { theme: "dark" },
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: "BRANDING_SETTINGS_UNKNOWN_FIELD",
    });
    expect(state.settings).toEqual({});
  });

  it("rejects an app name over the length limit", async () => {
    const router = buildRouter(fakeRequireAdmin("admin"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      { appName: "x".repeat(61) },
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: "BRANDING_SETTINGS_INVALID",
      field: "appName",
    });
    expect(state.settings).toEqual({});
  });

  it("rejects malformed/non-raster logo data without persisting it", async () => {
    const router = buildRouter(fakeRequireAdmin("admin"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      {
        logo: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`,
      },
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: "BRANDING_SETTINGS_INVALID",
      field: "logo",
    });
    expect(state.settings).toEqual({});
  });

  it("clears the logo when patched with null", async () => {
    state.settings.branding_logo = pngDataUrl;
    const router = buildRouter(fakeRequireAdmin("admin"));

    const response = await invokeChain(
      handlersFor(router, "/branding", "patch"),
      { logo: null },
    );

    expect(response.statusCode).toBe(200);
    expect(state.settings.branding_logo).toBeUndefined();
    expect(response.body).toMatchObject({ logo: null });
  });
});
