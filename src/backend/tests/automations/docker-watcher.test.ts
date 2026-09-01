import { describe, expect, it } from "vitest";
import {
  diffContainerStates,
  parseContainerStates,
} from "../../automations/docker-watcher.js";

/**
 * The polling side needs SSH, so what is tested here is the pure part: turning
 * `docker ps` output into states, and turning two snapshots into events.
 */

describe("parseContainerStates", () => {
  it("reads name, state and health out of the ps output", () => {
    const output = [
      '{"name":"web","state":"running","status":"Up 2 hours"}',
      '{"name":"db","state":"exited","status":"Exited (0) 5 minutes ago"}',
      '{"name":"api","state":"running","status":"Up 1 hour (unhealthy)"}',
    ].join("\n");

    const states = parseContainerStates(output);

    expect(states.get("web")).toEqual({ state: "running", unhealthy: false });
    expect(states.get("db")).toEqual({ state: "exited", unhealthy: false });
    expect(states.get("api")).toEqual({ state: "running", unhealthy: true });
  });

  it("skips blank and malformed lines rather than failing the poll", () => {
    const output = [
      '{"name":"web","state":"running","status":"Up"}',
      "",
      "not json at all",
      '{"state":"running"}',
    ].join("\n");

    const states = parseContainerStates(output);
    expect([...states.keys()]).toEqual(["web"]);
  });

  it("returns nothing for empty output", () => {
    expect(parseContainerStates("").size).toBe(0);
  });
});

describe("diffContainerStates", () => {
  const running = { state: "running", unhealthy: false };
  const exited = { state: "exited", unhealthy: false };

  it("reports a container that stopped", () => {
    const events = diffContainerStates(
      new Map([["web", running]]),
      new Map([["web", exited]]),
    );
    expect(events).toEqual([{ container: "web", event: "exited" }]);
  });

  it("reports a container that started", () => {
    const events = diffContainerStates(
      new Map([["web", exited]]),
      new Map([["web", running]]),
    );
    expect(events).toEqual([{ container: "web", event: "started" }]);
  });

  it("reports a container that began restarting", () => {
    const events = diffContainerStates(
      new Map([["web", running]]),
      new Map([["web", { state: "restarting", unhealthy: false }]]),
    );
    expect(events).toEqual([{ container: "web", event: "restarting" }]);
  });

  it("reports a container that went unhealthy while still running", () => {
    const events = diffContainerStates(
      new Map([["web", running]]),
      new Map([["web", { state: "running", unhealthy: true }]]),
    );
    expect(events).toEqual([{ container: "web", event: "unhealthy" }]);
  });

  it("stays quiet when nothing changed", () => {
    const events = diffContainerStates(
      new Map([["web", running]]),
      new Map([["web", running]]),
    );
    expect(events).toEqual([]);
  });

  it("does not re-announce a container that is still unhealthy", () => {
    const unhealthy = { state: "running", unhealthy: true };
    const events = diffContainerStates(
      new Map([["web", unhealthy]]),
      new Map([["web", unhealthy]]),
    );
    expect(events).toEqual([]);
  });

  // A first sighting is a baseline, not an event: otherwise every container
  // running at boot would report itself as freshly started.
  it("treats a newly seen container as a baseline", () => {
    const events = diffContainerStates(new Map(), new Map([["web", running]]));
    expect(events).toEqual([]);
  });

  it("ignores a container that disappeared", () => {
    const events = diffContainerStates(new Map([["web", running]]), new Map());
    expect(events).toEqual([]);
  });
});
