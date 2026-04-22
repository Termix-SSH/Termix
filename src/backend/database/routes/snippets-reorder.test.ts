import assert from "node:assert/strict";
import test from "node:test";

import { extractSnippetReorderUpdates } from "./snippets-reorder.ts";

test("extractSnippetReorderUpdates accepts snippets payloads", () => {
  const updates = extractSnippetReorderUpdates({
    snippets: [{ id: 1, order: 0, folder: "" }],
  });

  assert.deepEqual(updates, [{ id: 1, order: 0, folder: "" }]);
});

test("extractSnippetReorderUpdates accepts updates payloads", () => {
  const updates = extractSnippetReorderUpdates({
    updates: [{ id: 2, order: 1, folder: "shared" }],
  });

  assert.deepEqual(updates, [{ id: 2, order: 1, folder: "shared" }]);
});

test("extractSnippetReorderUpdates rejects invalid payloads", () => {
  assert.equal(extractSnippetReorderUpdates(null), null);
  assert.equal(extractSnippetReorderUpdates({}), null);
  assert.deepEqual(extractSnippetReorderUpdates({ snippets: [] }), []);
});
