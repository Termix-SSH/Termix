import { describe, expect, it, vi } from "vitest";

const { pluginWsUrl } = vi.hoisted(() => ({ pluginWsUrl: vi.fn() }));
vi.mock("@termix/plugin-sdk/ui", () => ({ pluginWsUrl }));
import { wsTargetForPath } from "../../src/frontend/shared";

describe("meeting event transport", () => {
  it("preserves remote authentication protocols and event query parameters", async () => {
    pluginWsUrl.mockResolvedValue({
      url: "wss://server/base/plugin-ws/ssh-terminal/terminal",
      protocols: ["jwt", "session-token"],
    });
    expect(
      await wsTargetForPath(
        "/plugin-ws/ssh-terminal/terminal?room=abc",
        "remote",
      ),
    ).toEqual({
      url: "wss://server/base/plugin-ws/ssh-terminal/terminal?room=abc",
      protocols: ["jwt", "session-token"],
    });
    expect(pluginWsUrl).toHaveBeenCalledWith("ssh-terminal", "/terminal", {
      origin: "remote",
    });
    expect(
      await wsTargetForPath("https://another-server/ws", "remote"),
    ).toBeNull();
  });
});
