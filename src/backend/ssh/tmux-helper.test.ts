import { describe, expect, it } from "vitest";
import { tmuxCommand, withTmuxPath } from "./tmux-helper.js";

describe("tmux command path handling", () => {
  it("adds common non-login shell tmux paths", () => {
    const command = withTmuxPath("command -v tmux");

    expect(command).toContain("/opt/homebrew/bin");
    expect(command).toContain("/usr/local/bin");
    expect(command).toContain("/opt/bin");
    expect(command).toContain("/usr/pkg/bin");
    expect(command).toContain(":$PATH; command -v tmux");
  });

  it("wraps tmux invocations with the same path", () => {
    expect(tmuxCommand("list-sessions")).toMatch(
      /^PATH=.*:\$PATH; tmux list-sessions$/,
    );
  });
});
