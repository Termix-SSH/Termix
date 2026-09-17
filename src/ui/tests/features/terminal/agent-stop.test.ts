// @vitest-environment node
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
const source = fs.readFileSync(
  new URL("../../../features/terminal/Terminal.tsx", import.meta.url),
  "utf8",
);
const start = source.slice(
  source.indexOf("    const handleStartAgent ="),
  source.indexOf("    const handleAgentUserReply ="),
);
const stop = source.slice(
  source.indexOf("    const handleStopAgent ="),
  source.indexOf("    const activityLoggingRef ="),
);
function harness(request: Promise<unknown>) {
  const applyAgentResult = vi.fn(),
    cancel = vi.fn();
  const context = {
    useCallback: (fn: unknown) => fn,
    agentRequestVersion: { current: 0 },
    window: {
      electronAPI: {
        startTerminalAgentSession: () => request,
        cancelTerminalAgentSession: cancel,
      },
    },
    agentPrompt: "list files",
    agentMode: "yolo",
    agentSessionId: null,
    buildAiTerminalContext: () => ({}),
    applyAgentResult,
    terminal: null,
    setAgentError: vi.fn(),
    setAgentPanelOpen: vi.fn(),
    setAgentLoading: vi.fn(),
    setAgentAction: vi.fn(),
    setAgentTranscript: vi.fn(),
    clearAgentCapture: vi.fn(),
    appendAgentTranscript: vi.fn(),
    setAgentSessionId: vi.fn(),
    setAgentPrompt: vi.fn(),
    setAgentRunningCommand: vi.fn(),
    setTimeout: vi.fn(),
  };
  const code = ts.transpileModule(
    start + stop + "\n({start: handleStartAgent, stop: handleStopAgent});",
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return { ...vm.runInNewContext(code, context), applyAgentResult, cancel };
}
describe("terminal agent stop", () => {
  it("discards a late command and cleans up a session created after Stop", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const h = harness(pending);
    const running = h.start();
    h.stop();
    resolve({
      success: true,
      sessionId: "late-session",
      action: { type: "run_command", command: "pwd" },
    });
    await running;
    expect(h.applyAgentResult).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledWith("late-session");
  });
  it("still applies a current session result", async () => {
    const action = { type: "run_command", command: "pwd" };
    const h = harness(
      Promise.resolve({ success: true, sessionId: "active", action }),
    );
    await h.start();
    expect(h.applyAgentResult).toHaveBeenCalledWith(action);
  });
});
