# AI Assistant

An AI assistant that can read your hosts, snippets, fleets, alerts and automations, and suggest changes for you to approve.

## Features

- Chat with an assistant that can read your hosts, snippets, fleets, alerts, automations, workspaces, network graph and homepage.
- The assistant suggests changes, and nothing is applied until you approve it.
- Can run read-only diagnostic commands on a host if you allow it.
- Open the assistant from the terminal toolbar with the current session as context.
- Works with Ollama, Anthropic, OpenAI, Google Gemini and any OpenAI compatible provider.

## Settings

### Admin

- AI assistant: let users turn the assistant on. While this is off it is hidden for everyone.
- Allowed private AI hosts: hosts on your private network a provider may point at, such as a self-hosted Ollama.

### User

- Enable the AI assistant: turn the assistant on for yourself.
- Allow read-only diagnostic commands: let the assistant run safe commands on your hosts.
- Providers: the AI providers, models and API keys you use.

### Host

- Enable AI Assistant: allow the assistant to work with this host.

## Permissions

- `ai.use`: Open the assistant and ask it things. Admins and users have it by default.
- `ai.manage_providers`: Add, edit and remove AI providers and their API keys. Admins and users have it by default.
- `ai.apply_proposals`: Let the assistant carry out the changes it suggests. Admins and users have it by default.
- `ai.services.use`: Let other features call the assistant for you. Admins and users have it by default.
- `ai.secrets.share`: Let other features use the stored AI API key without seeing it. Admins and users have it by default.

## Services

Uses from other plugins:

- `workspaces.saved`, `network-topology.graph`, `snippets.access`, `fleets.access`, `terminal.history`, `automations.access` and `homepage.items` to read your data. Each one is optional.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
