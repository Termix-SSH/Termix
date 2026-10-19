import { beforeEach, describe, expect, it, vi } from "vitest";
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

function routesOf(router: express.Router) {
  return (router as unknown as { stack: RouteLayer[] }).stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route!.path,
      methods: Object.keys(layer.route!.methods),
      handlers: layer.route!.stack.map((entry) => entry.handle),
    }));
}

async function call(handler: RequestHandler) {
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
  await handler(
    { body: {}, headers: {} } as Request,
    res,
    (() => {}) as NextFunction,
  );
  return result;
}

beforeEach(() => {
  state.settings = {};
});

describe("GET /users/branding", () => {
  it("is the only branding route and has no auth handler", () => {
    const router = express.Router();
    registerBrandingRoutes(router);
    const routes = routesOf(router);

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/branding");
    expect(routes[0].methods).toEqual(["get"]);
    expect(routes[0].handlers).toHaveLength(1);
  });

  it("answers defaults when nothing is set", async () => {
    const router = express.Router();
    registerBrandingRoutes(router);
    const response = await call(routesOf(router)[0].handlers[0]);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      appName: "Termix",
      tagline: "",
      logo: null,
    });
  });

  it("keeps serving the stored branding of an older install", async () => {
    state.settings = {
      branding_app_name: "Acme",
      branding_tagline: "Ops",
    };
    const router = express.Router();
    registerBrandingRoutes(router);
    const response = await call(routesOf(router)[0].handlers[0]);

    expect(response.body).toEqual({
      appName: "Acme",
      tagline: "Ops",
      logo: null,
    });
  });
});
