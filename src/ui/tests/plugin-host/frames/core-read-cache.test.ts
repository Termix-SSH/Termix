import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedCoreRead,
  clearCoreReadCache,
  copyCoreResponse,
  CORE_READ_TTL_MS,
  isCacheableCoreRead,
  noteCoreRequest,
  type CachedCoreResponse,
} from "@/plugin-host/frames/core-read-cache";

const ok = (text = "{}"): CachedCoreResponse => ({
  status: 200,
  type: "application/json",
  body: new TextEncoder().encode(text).buffer as ArrayBuffer,
});

afterEach(() => clearCoreReadCache());

describe("core read cache", () => {
  it("caches only the listed reads", () => {
    expect(isCacheableCoreRead("GET", "/rbac/permissions/me")).toBe(true);
    expect(isCacheableCoreRead("GET", "/users/me")).toBe(true);
    expect(isCacheableCoreRead("GET", "/user-preferences")).toBe(true);
    expect(
      isCacheableCoreRead("GET", "/plugins/host-metrics/settings/user"),
    ).toBe(true);
    expect(isCacheableCoreRead("GET", "/plugins/docker/settings/host/12")).toBe(
      true,
    );
    expect(isCacheableCoreRead("PUT", "/users/me")).toBe(false);
    expect(isCacheableCoreRead("GET", "/credentials")).toBe(false);
    expect(isCacheableCoreRead("GET", "/users/sessions")).toBe(false);
  });

  it("shares one request between callers inside the window", async () => {
    const load = vi.fn(async () => ok());
    await Promise.all([
      cachedCoreRead("/users/me", load),
      cachedCoreRead("/users/me", load),
    ]);
    await cachedCoreRead("/users/me", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks again once the window passes", async () => {
    let now = 1000;
    const load = vi.fn(async () => ok());
    await cachedCoreRead("/users/me", load, () => now);
    now += CORE_READ_TTL_MS + 1;
    await cachedCoreRead("/users/me", load, () => now);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never keeps a failed or refused answer", async () => {
    const refused = vi.fn(async () => ({ ...ok(), status: 403 }));
    await cachedCoreRead("/rbac/permissions/me", refused);
    await cachedCoreRead("/rbac/permissions/me", refused);
    expect(refused).toHaveBeenCalledTimes(2);

    const broken = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(cachedCoreRead("/users/me", broken)).rejects.toThrow();
    await expect(cachedCoreRead("/users/me", broken)).rejects.toThrow();
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it("drops everything on a write, but not on a read", async () => {
    const load = vi.fn(async () => ok());
    await cachedCoreRead("/users/me", load);
    noteCoreRequest("get");
    await cachedCoreRead("/users/me", load);
    expect(load).toHaveBeenCalledTimes(1);
    noteCoreRequest("put");
    await cachedCoreRead("/users/me", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not keep a read that was in flight during a write", async () => {
    let release!: (value: CachedCoreResponse) => void;
    const slow = vi.fn(
      () => new Promise<CachedCoreResponse>((resolve) => (release = resolve)),
    );
    const pending = cachedCoreRead("/user-preferences", slow);
    noteCoreRequest("PATCH");
    release(ok());
    await pending;
    const fresh = vi.fn(async () => ok());
    await cachedCoreRead("/user-preferences", fresh);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("drops everything on logout and permission changes", async () => {
    for (const event of [
      "termix:logout",
      "permissionsChanged",
      "termix:plugin-settings-changed",
    ]) {
      clearCoreReadCache();
      const load = vi.fn(async () => ok());
      await cachedCoreRead("/rbac/permissions/me", load);
      window.dispatchEvent(new Event(event));
      await cachedCoreRead("/rbac/permissions/me", load);
      expect(load).toHaveBeenCalledTimes(2);
    }
  });

  it("hands each caller its own body", async () => {
    const shared = ok('{"a":1}');
    const copy = copyCoreResponse(shared);
    expect(copy.body).not.toBe(shared.body);
    expect(new TextDecoder().decode(copy.body)).toBe('{"a":1}');
  });
});
