import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectionGeneration,
  cutSince,
  endHostConnections,
  openConnectionCount,
  resetOpenConnections,
  trackConnection,
} from "../../hosts/open-connections.js";

afterEach(resetOpenConnections);

describe("open connections", () => {
  it("ends every tracked connection to a host and counts them", () => {
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    trackConnection(7, a);
    trackConnection(7, b);
    trackConnection(8, other);
    expect(openConnectionCount(7)).toBe(2);
    expect(endHostConnections(7)).toBe(2);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(openConnectionCount(7)).toBe(0);
  });

  it("stops tracking a closed connection", () => {
    const end = vi.fn();
    const untrack = trackConnection(7, end);
    untrack();
    expect(endHostConnections(7)).toBe(0);
    expect(end).not.toHaveBeenCalled();
  });

  it("marks connections still in their handshake as cut", () => {
    const generation = connectionGeneration(7);
    expect(cutSince(7, generation)).toBe(false);
    endHostConnections(7);
    expect(cutSince(7, generation)).toBe(true);
    expect(cutSince(8, connectionGeneration(8))).toBe(false);
  });

  it("ignores hosts with no id", () => {
    expect(trackConnection(undefined, vi.fn())()).toBeUndefined();
    expect(endHostConnections(0)).toBe(0);
  });
});
