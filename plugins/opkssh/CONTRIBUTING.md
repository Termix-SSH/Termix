# Contributing to OPKSSH

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

- **Redirect URI:** register `<base URL>/plugin-api/opkssh/callback` with every identity provider in your OPKSSH config
- **Use the old redirect URI:** keep sending the 2.8 URI `<base URL>/host/opkssh-callback`. Upgraded installs keep this on until you turn it off
