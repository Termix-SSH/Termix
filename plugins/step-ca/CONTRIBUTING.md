# Contributing to Step CA

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

- **CA URL, Root fingerprint and OIDC provisioner name:** leave all three empty to turn Step CA off
- **Allowed private Step CA hosts:** the CA and, if it is internal, the identity provider. Private hosts not on this list are refused
- **Redirect URI:** register `<base URL>/plugin-api/step-ca/callback` with your identity provider
- **Use the old redirect URI:** keep sending the 2.8 URI `<base URL>/host/step-ca-callback`. Upgraded installs keep this on until you turn it off
