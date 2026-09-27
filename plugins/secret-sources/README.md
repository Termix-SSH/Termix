# Secret Sources

Fetch host secrets from 1Password when you connect instead of storing them in Termix.

## Features

- Connect a 1Password Connect server as a secret source.
- Use `op://` references in a host's password or key fields instead of the secret itself.
- Secrets are fetched each time you connect and are not stored in Termix.

## Settings

### Admin

- Private endpoint allowlist: private or loopback hosts a secret source may reach, one per line. A self-hosted 1Password Connect server usually needs its address listed here.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
