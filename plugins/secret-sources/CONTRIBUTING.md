# Contributing to Secret Sources

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

- **Private endpoint allowlist:** private or loopback hosts a secret source may reach, one per line. A self-hosted 1Password Connect server usually needs its address listed here
