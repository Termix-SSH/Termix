# Remote AI agents

The **AI Agent** host action appears on the host card and in the SSH terminal toolbar. It opens a host-scoped session tab. Enable AI globally, opt in for the user, and grant `ai.agents` (administrators by default).

Choose Pi, OpenCode, Claude Code, or Codex; an existing Termix AI provider; a model; and an absolute working directory. The target needs POSIX SSH, Node.js 22.19+, the selected CLI on its login-shell PATH (or an explicit executable path), and SSH remote forwarding to `127.0.0.1`. Missing dependencies fail visibly. The explicit Install button installs the selected CLI and an isolated Node.js 24 LTS runtime; starting an agent never installs software automatically.

Termix owns the SSH connection, session history, streaming UI, cancellation, and permission responses. The remote runner uses the CLI's native protocol: Pi RPC, Claude streaming JSON, Codex app-server, or OpenCode's loopback HTTP API. No Paseo runtime or daemon is required.

Model requests travel over an SSH reverse tunnel to a session-scoped proxy. The proxy authenticates a random token, checks host access and AI permissions, restricts inference paths and the selected model, and uses the current user's saved Provider key and the existing AI private-endpoint allowlist. Provider keys never go to the browser or target. OpenAI/compatible endpoints support Pi and OpenCode; Claude needs Anthropic; Codex needs **Responses**, not just Chat Completions. Selecting an OpenAI-compatible record does not prove Responses support.

Agent state lives in the target user's `~/.local/state/termix-agents/<session-id>` and Termix's plugin KV store. Closing a tab leaves the session running; stop ends it. A server restart stops active transports; Resume reopens the native session where supported. Sessions expire after eight hours. Up to four sessions may run per user. The UI retains the most recent 2,000 events; native history remains on the target. Deleting a Termix session does not delete its target-side directory.

The agent runs with the SSH user's authority. Claude/OpenCode/Codex approval requests are shown in the tab; Pi's ordinary tools run without per-tool approval. Pi extension prompts are forwarded. Structured native questions currently accept JSON answers. Root SSH gives the agent root privileges; select the account and directory accordingly. No global agent config is overwritten.

The initial host action asks for the working directory explicitly; it does not infer one from terminal buffer text. This release does not add Git worktrees, file diff review, attachments, mobile-native UI, or cross-host session migration.

## Validation

`tests/backend/agents/agents.test.ts` covers target/command validation, inference-path restrictions, protocol compatibility, and four native-protocol fixture processes including an approval round trip. A real provider turn must also be checked separately; fixture success is not model access verification.

## Official runtime installation

The host panel provides **Install selected agent and Node.js**, with streamed progress and version verification. It uses the same host access, AI opt-in, and `ai.agents` permission as remote sessions, and records an audit event. Installation needs curl, tar, a SHA-256 utility, and Linux/macOS x64 or arm64. It requires no sudo and does not change system packages, shell profiles, existing CLI installations, or SSH forwarding policy. Stop active agents on the host before installing.

Node.js 24 LTS comes from https://nodejs.org/dist/ and must match the official SHA-256 manifest. Agent package names are fixed to the official documentation: [Pi](https://pi.dev/docs/latest/quickstart), [OpenCode](https://opencode.ai/docs/), [Claude Code](https://code.claude.com/docs/en/setup), and [Codex](https://developers.openai.com/cookbook/examples/codex/secure_quality_gitlab). Only https://registry.npmjs.org dependencies are accepted; missing SHA-512 lock entries are filled from matching official version metadata. npm ci checks the locked integrity values. User/global npm configuration and lifecycle scripts are disabled. Claude/OpenCode use the verified optional platform binary directly, without running download scripts. No third-party mirror or arbitrary installer URL is accepted.

Files live under `~/.local/share/termix-agent-runtime`. Termix automatically uses this runtime for launches with the default executable. A verified replacement retains the previous installation in `<agent>.previous`. Unsupported systems, missing prerequisites, download failures, checksum mismatches, and unavailable platform binaries fail visibly without activating the replacement. SSH remote forwarding remains a separate administrator setting.
