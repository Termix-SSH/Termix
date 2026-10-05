# Contributing to AI Assistant

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Admin

- **AI assistant:** let users turn the assistant on. While this is off it is hidden and blocked for everyone
- **Allowed private AI hosts:** hosts on your private network a provider may point at, such as a self-hosted Ollama

### User

- **Enable the AI assistant:** turn the assistant on for yourself
- **Allow read-only diagnostic commands:** let the assistant run safe commands without asking
- **Providers:** your AI providers, models and API keys

### Host

- **Enable AI Assistant:** let the assistant help in this host's terminal. Off by default

## Permissions

- `ai.use`: use the assistant. Admins and users have it by default.
- `ai.manage_providers`: add, edit and remove AI providers and their API keys. Admins and users have it by default.
- `ai.apply_proposals`: let the assistant carry out the changes it suggests. Admins and users have it by default.
- `ai.services.use`: let other features call the assistant for you. Admins and users have it by default.
- `ai.secrets.share`: let other features use the stored API key without seeing it. Admins and users have it by default.
- `ai.agents`: run coding agents on SSH hosts. Only admins have it by default.
