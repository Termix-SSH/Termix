# Remote AI agents

The **AI Agent** host action appears on the host card and in the SSH terminal toolbar. It opens a host-scoped session tab. Enable AI globally, opt in for the user, and grant `ai.agents` (administrators by default).

Choose Pi, OpenCode, Claude Code, or Codex; an existing Termix AI provider; a model; and an absolute working directory. The target needs POSIX SSH, Node.js 22.19+, the selected CLI on its login-shell PATH (or an explicit executable path), and SSH remote forwarding to `127.0.0.1`. Missing dependencies fail visibly. The explicit Install button installs the selected CLI and an isolated Node.js 24 LTS runtime; starting an agent never installs software automatically.

Termix owns the SSH connection, session history, streaming UI, cancellation, and permission responses. The remote runner uses the CLI's native protocol: Pi RPC, Claude streaming JSON, Codex app-server, or OpenCode's loopback HTTP API. No Paseo runtime or daemon is required.

Model requests travel over an SSH reverse tunnel to a session-scoped proxy. The proxy authenticates a random token, checks host access and AI permissions, restricts inference paths and the selected model, and uses the current user's saved Provider key and the existing AI private-endpoint allowlist. Provider keys never go to the browser or target. OpenAI/compatible endpoints support Pi and OpenCode; Claude needs Anthropic; Codex needs **Responses**, not just Chat Completions. Selecting an OpenAI-compatible record does not prove Responses support.

Agent state lives in the target user's `~/.local/state/termix-agents/<session-id>` and the AI plugin's own tables (`agent_sessions`, with events and queued prompts as separate rows). Prompts, drafts and stored event text are limited to 65,535 UTF-8 bytes, the MySQL TEXT limit. Closing a tab leaves the session running; stop ends it. A server restart stops active transports; Resume reopens the native session where supported. Sessions expire after eight hours. Up to four sessions may run per user. The UI retains the most recent 2,000 events; native history remains on the target. Deleting a Termix session does not delete its target-side directory.

The agent runs with the SSH user's authority. Claude/OpenCode/Codex approval requests are shown in the tab; Pi's ordinary tools run without per-tool approval. Pi extension prompts are forwarded. Structured native questions currently accept JSON answers. Root SSH gives the agent root privileges; select the account and directory accordingly. No global agent config is overwritten.

The initial host action asks for the working directory explicitly; it does not infer one from terminal buffer text. Mobile-native UI and cross-host session migration are outside this release.

## Validation

`tests/backend/agents/agents.test.ts` covers target/command validation, inference-path restrictions, protocol compatibility, and four native-protocol fixture processes including an approval round trip. A real provider turn must also be checked separately; fixture success is not model access verification.

## Official runtime installation

The host panel provides **Install selected agent and Node.js**, with streamed progress and version verification. It uses the same host access, AI opt-in, and `ai.agents` permission as remote sessions, and records an audit event. Installation needs curl, tar, a SHA-256 utility, and Linux/macOS x64 or arm64. It requires no sudo and does not change system packages, shell profiles, existing CLI installations, or SSH forwarding policy. Stop active agents on the host before installing.

Node.js 24 LTS comes from https://nodejs.org/dist/ and must match the official SHA-256 manifest. Agent package names are fixed to the official documentation: [Pi](https://pi.dev/docs/latest/quickstart), [OpenCode](https://opencode.ai/docs/), [Claude Code](https://code.claude.com/docs/en/setup), and [Codex](https://developers.openai.com/cookbook/examples/codex/secure_quality_gitlab). Only https://registry.npmjs.org dependencies are accepted; missing SHA-512 lock entries are filled from matching official version metadata. npm ci checks the locked integrity values. User/global npm configuration and lifecycle scripts are disabled. Claude/OpenCode use the verified optional platform binary directly, without running download scripts. No third-party mirror or arbitrary installer URL is accepted.

Files live under `~/.local/share/termix-agent-runtime`. Termix automatically uses this runtime for launches with the default executable. A verified replacement retains the previous installation in `<agent>.previous`. Unsupported systems, missing prerequisites, download failures, checksum mismatches, and unavailable platform binaries fail visibly without activating the replacement. SSH remote forwarding remains a separate administrator setting.

## Enable Agent forwarding

The separate **Enable Agent forwarding** button configures standard Linux/systemd OpenSSH servers using root or non-interactive sudo. It derives the SSH account and actual peer address from the SSH connection, rather than accepting them from the browser. Existing working remote forwarding is left unchanged. Otherwise, it inserts a scoped `Match User ... Address ...` block allowing `127.0.0.1:*` remote listeners with `GatewayPorts no`; existing local forwarding is preserved. This uses the same host access and `ai.agents` gates and records an audit event.

The operation backs up sshd_config under `/etc/ssh/termix-agent-backups`, validates both syntax and effective rules before activation, and reloads the active SSH service. Failed activation/reload restores the previous configuration. Existing `DisableForwarding` policies are not overridden. Start/resume creates a new SSH connection after a successful change. Idempotency, preservation of local forwarding, invalid configuration rejection, and reload-failure rollback are covered by executable shell fixtures.

After configuration, Termix opens a fresh SSH connection and verifies an actual loopback remote listener before reporting success. Key-level forwarding restrictions or a different active server configuration therefore remain visible failures.

The conversation composer sends with Enter and inserts a newline with Shift+Enter. Escape interrupts a running agent when focus is inside its panel. IME composition and repeated keydown events do not submit or interrupt; a failed send preserves the draft.

## Conversation workflow

- Enter sends an idle turn or queues a message while running. A session stores up to 20 queued messages, each editable/removable until dispatched. Dispatch is FIFO after completion; cancellation, archive, and remote errors pause the queue. Continue explicitly resumes it. A stopped session must be resumed first. Messages already dispatched are not automatically replayed after a transport failure.
- Rename and search sessions by name/model/directory. Archive stops the remote process and pauses its queue; restore preserves its transcript. Composer drafts are saved per session after 500 ms and on tab/session unmount. Unsent attachments remain reusable in the session attachment picker.
- Upload a file, paste an image into the composer, or reference a regular file within the working directory (symlinks outside it are rejected). Limits: 1 MiB per file, four per message, 100 per session. Uploads live in the remote user's private session directory. Image MIME is detected from bytes and sent through native Pi/Claude/Codex/OpenCode image inputs; the selected provider/model must support vision. Other files are referenced by their host path for the agent's tools. No file is sent to the model until a message using it is dispatched.
- Git review lists changed/untracked files and shows unstaged and staged diffs, including deleted files. Worktree creation makes a new branch from HEAD in the remote user's Termix state directory. It preserves uncommitted changes in the original workspace, does not overwrite an existing branch, and offers a new session in the resulting directory. Repository hooks, external diff commands, and textconv are disabled for these operations. Worktrees are retained until the user removes them explicitly.
- Browser event streams reconnect with bounded backoff and refresh a persisted snapshot before continuing from its sequence cursor. Duplicate events are suppressed and events are written in batches at most once a second. Access-denied sessions stop retrying. A server/SSH restart still requires Resume; the UI never replays a potentially executed command. The 2,000-event UI retention limit still applies.

Tests cover FIFO/cancel behavior through the HTTP routes, cross-user metadata/attachment access, native image payloads for four CLI protocols, real temporary Git repositories, path/size boundaries, archive persistence, keyboard/IME handling, and dropped-stream recovery.
