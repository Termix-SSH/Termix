import type { TabProps } from "@termix/plugin-sdk/frontend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  fetch: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("../../src/frontend/app-ref", () => ({
  aiApp: () => ({ api: mocks, fetch: mocks.fetch }),
}));
vi.mock("../../src/frontend/ai-api", () => ({
  getAiProviders: async () => [],
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock("../../src/frontend/AiMessage", () => ({ AiMessage: () => null }));
import { AgentPanel } from "../../src/frontend/agents/AgentPanel";

beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.post.mockResolvedValue({ data: {} });
  mocks.patch.mockResolvedValue({ data: {} });
  mocks.fetch.mockImplementation(async () => new Response("", { status: 200 }));
});
afterEach(cleanup);

async function panel(status = "ready") {
  const session = {
    id: "test",
    hostId: 2,
    agent: "pi",
    model: "test-model",
    cwd: "/tmp",
    status,
    events: [],
  };
  mocks.get.mockImplementation(async (path: string) => ({
    data: path === "/agents" ? { sessions: [session] } : session,
  }));
  render(
    <AgentPanel
      {...({
        host: { id: "2", name: "test", ip: "127.0.0.1", port: 22 },
      } as TabProps)}
    />,
  );
  fireEvent.click(await screen.findByText("Pi · test-model"));
  const textarea = await screen.findByRole("textbox", {
    name: "agents.prompt",
  });
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  fireEvent.change(textarea, { target: { value: "hello" } });
  return textarea;
}

it("sends on Enter and clears the draft", async () => {
  const textarea = await panel();
  expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/agents/test/input", {
      type: "prompt",
      text: "hello",
      attachmentIds: [],
    }),
  );
  await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(""));
  expect(mocks.post).toHaveBeenCalledTimes(1);
});

it("preserves Shift+Enter, composition Enter, legacy IME keys and key repeats", async () => {
  const textarea = await panel();
  expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(
    true,
  );
  fireEvent.compositionStart(textarea);
  expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
  fireEvent.compositionEnd(textarea);
  expect(fireEvent.keyDown(textarea, { key: "Enter", isComposing: true })).toBe(
    true,
  );
  expect(fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 })).toBe(
    true,
  );
  fireEvent.keyDown(textarea, { key: "Enter", repeat: true });
  expect(mocks.post).not.toHaveBeenCalled();
});

it("does not submit whitespace via Enter or direct form submission", async () => {
  const textarea = await panel();
  fireEvent.change(textarea, { target: { value: " \n " } });
  fireEvent.keyDown(textarea, { key: "Enter" });
  fireEvent.submit(textarea.closest("form")!);
  expect(mocks.post).not.toHaveBeenCalled();
});

it("interrupts only the focused panel and leaves the draft intact", async () => {
  const textarea = await panel("running");
  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.compositionStart(textarea);
  fireEvent.keyDown(textarea, { key: "Escape" });
  fireEvent.compositionEnd(textarea);
  fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
  fireEvent.keyDown(textarea, { key: "Escape", keyCode: 229 });
  fireEvent.keyDown(textarea, { key: "Escape", repeat: true });
  expect(mocks.post).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(textarea, { key: "Escape" })).toBe(false);
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/agents/test/input", {
      type: "cancel",
    }),
  );
  expect((textarea as HTMLTextAreaElement).value).toBe("hello");
});

it("ignores Escape for an idle session", async () => {
  const textarea = await panel();
  fireEvent.keyDown(textarea, { key: "Escape" });
  expect(mocks.post).not.toHaveBeenCalled();
});

it("keeps the draft and permits retry when sending fails", async () => {
  const textarea = await panel();
  mocks.post.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.keyDown(textarea, { key: "Enter" });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Connection lost"),
  );
  expect((textarea as HTMLTextAreaElement).value).toBe("hello");
  fireEvent.keyDown(textarea, { key: "Enter" });
  await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(""));
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
