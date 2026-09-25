import { afterEach, describe, expect, it } from "vitest";
import {
  clearTransferProfiles,
  flushTransferProfiles,
  getTransferProfile,
  initializeTransferProfiles,
  recordTransferProfile,
  setTransferProfileStore,
  type PersistedProfiles,
} from "../../src/backend/transfer-tuning.js";

afterEach(() => {
  setTransferProfileStore(null);
  clearTransferProfiles();
});

function memoryStore() {
  let saved: PersistedProfiles | undefined;
  return {
    store: {
      read: async () => saved,
      write: async (value: PersistedProfiles) => {
        saved = JSON.parse(JSON.stringify(value));
      },
    },
    saved: () => saved,
  };
}

describe("transfer profile store", () => {
  it("saves learned profiles and reads them back after a restart", async () => {
    const memory = memoryStore();
    setTransferProfileStore(memory.store);
    await initializeTransferProfiles();

    recordTransferProfile("host-a:host-b", {
      bytes: 50 * 1024 * 1024,
      durationMs: 5000,
      lanes: 4,
      pipelineConcurrency: 8,
      failed: false,
      now: Date.now(),
    });
    await flushTransferProfiles();
    expect(Object.keys(memory.saved()?.profiles ?? {})).toHaveLength(1);

    // A fresh activation starts from what the store holds.
    setTransferProfileStore(memory.store);
    await initializeTransferProfiles();
    expect(getTransferProfile("host-a:host-b")).toBeDefined();
  });

  it("works without a store", async () => {
    await initializeTransferProfiles();
    expect(getTransferProfile("nothing")).toBeUndefined();
  });
});
