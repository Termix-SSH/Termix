/// <reference types="vite/client" />
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import roomSource from "../../src/frontend/CollabRoomTab.tsx?raw";

// Run the room's real refresh callback across successive server snapshots.
const source = ts.createSourceFile(
  "CollabRoomTab.tsx",
  roomSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback: string | undefined;
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === "refresh" &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  ) {
    callback = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (!callback) throw new Error("Missing room refresh callback");
const refresh = new Function(
  "state",
  ts.transpileModule(
    `
  const { roomId, refreshSequence, presenterRef, stageKeyRef, draftRef,
    getCollabRoom, getCollabStage, setDetail, setLoadError, setDraft,
    setStage, getErrorMessage } = state;
  return (${callback})();
`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText,
) as (state: ReturnType<typeof fixture>) => Promise<void>;

function snapshot(presenterUserId: string, shareId: string) {
  return {
    me: "alice",
    stage: { presenterUserId, shareId },
    controllerUserId: null,
  };
}

function fixture() {
  const state = {
    roomId: "room",
    refreshSequence: { current: 0 },
    presenterRef: { current: null as string | null },
    stageKeyRef: { current: null as string | null },
    draftRef: { current: null as object | null },
    getCollabRoom: vi.fn(async () => snapshot("alice", "alice-share")),
    getCollabStage: vi.fn(async () => ({ stage: { shareId: "bob-share" } })),
    setDetail: vi.fn(),
    setLoadError: vi.fn(),
    setDraft: vi.fn((draft: object | null) => {
      state.draftRef.current = draft;
    }),
    setStage: vi.fn(),
    getErrorMessage: String,
  };
  return state;
}

describe("meeting presenter takeover", () => {
  it("replaces the previous presenter's local session with the new stage", async () => {
    const state = fixture();
    state.draftRef.current = { protocol: "ssh", host: { id: 1 } };
    await refresh(state);
    state.getCollabRoom.mockResolvedValue(snapshot("bob", "bob-share"));
    await refresh(state);

    expect(state.draftRef.current).toBeNull();
    expect(state.setStage).toHaveBeenCalledWith({ shareId: "bob-share" });
    expect(state.getCollabStage).toHaveBeenCalledWith("room");
  });

  it("keeps a new connection being prepared to take over another presenter", async () => {
    const state = fixture();
    state.getCollabRoom.mockResolvedValue(snapshot("bob", "bob-share"));
    await refresh(state);
    const draft = { protocol: "ssh", host: { id: 2 } };
    state.draftRef.current = draft;
    await refresh(state);

    expect(state.draftRef.current).toBe(draft);
    expect(state.setDraft).not.toHaveBeenCalled();
  });

  it("keeps the local session during ordinary room refreshes", async () => {
    const state = fixture();
    const draft = { protocol: "ssh", host: { id: 1 } };
    state.draftRef.current = draft;
    await refresh(state);
    await refresh(state);

    expect(state.draftRef.current).toBe(draft);
    expect(state.getCollabStage).not.toHaveBeenCalled();
    expect(state.setDraft).not.toHaveBeenCalled();
  });
});
