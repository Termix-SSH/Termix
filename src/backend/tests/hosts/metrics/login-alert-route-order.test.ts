import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Regression guard for: the /internal/login-alert route was registered
// after the global JWT auth middleware, so every service-to-service login
// alert got rejected with 401 before the route's own IP+token check ever
// ran. Spinning up the full metrics-service Express app (DB, SSH clients,
// polling managers, etc.) just to hit this one route is out of scope, so
// this asserts the registration order directly against the source instead.
describe("metrics service /internal/login-alert route order", () => {
  it("is registered before the global auth middleware", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../hosts/metrics/index.ts"),
      "utf8",
    );

    const routeIndex = source.indexOf('app.post("/internal/login-alert"');
    const authMiddlewareIndex = source.indexOf(
      "app.use(authManager.createAuthMiddleware())",
    );

    expect(routeIndex).toBeGreaterThan(-1);
    expect(authMiddlewareIndex).toBeGreaterThan(-1);
    expect(routeIndex).toBeLessThan(authMiddlewareIndex);
  });
});
