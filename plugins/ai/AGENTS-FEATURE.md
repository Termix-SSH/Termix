# Remote AI agents

The **AI Agent** host action appears on the host card and in the SSH terminal toolbar. It opens a host-scoped session tab. Enable AI globally, opt in for the user, and grant `ai.agents` (administrators by default).

Choose Pi, OpenCode, Claude Code, or Codex; an existing Termix AI provider; a model; and an absolute working directory. The target needs POSIX SSH, Node.js 20+, the selected CLI on its login-shell PATH (or an explicit executable path), and SSH remote forwarding to `127.0.0.1`. Missing dependencies fail visibly; Termix does not install software automatically.

Termix owns the SSH connection, session history, streaming UI, cancellation, and permission responses. The remote runner uses the CLI's native protocol: Pi RPC, Claude streaming JSON, Codex app-server, or OpenCode's loopback HTTP API. No Paseo runtime or daemon is required.

Model requests travel over an SSH reverse tunnel to a session-scoped proxy. The proxy authenticates a random token, checks host access and AI permissions, restricts inference paths and the selected model, and uses the current user's saved Provider key and the existing AI private-endpoint allowlist. Provider keys never go to the browser or target. OpenAI/compatible endpoints support Pi and OpenCode; Claude needs Anthropic; Codex needs **Responses**, not just Chat Completions. Selecting an OpenAI-compatible record does not prove Responses support.

Agent state lives in the target user's `~/.local/state/termix-agents/<session-id>` and Termix's plugin KV store. Closing a tab leaves the session running; stop ends it. A server restart stops active transports; Resume reopens the native session where supported. Sessions expire after eight hours. Up to four sessions may run per user. The UI retains the most recent 2,000 events; native history remains on the target. Deleting a Termix session does not delete its target-side directory.

The agent runs with the SSH user's authority. Claude/OpenCode/Codex approval requests are shown in the tab; Pi's ordinary tools run without per-tool approval. Pi extension prompts are forwarded. Structured native questions currently accept JSON answers. Root SSH gives the agent root privileges; select the account and directory accordingly. No global agent config is overwritten.

The initial host action asks for the working directory explicitly; it does not infer one from terminal buffer text. This release does not add Git worktrees, file diff review, attachments, mobile-native UI, or cross-host session migration.

## Validation

`tests/backend/agents/agents.test.ts` covers target/command validation, inference-path restrictions, protocol compatibility, and four native-protocol fixture processes including an approval round trip. A real provider turn must also be checked separately; fixture success is not model access verification.
