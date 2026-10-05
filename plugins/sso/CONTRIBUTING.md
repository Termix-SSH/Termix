# Contributing to Single sign-on

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

- **Providers:** add a provider, then register the redirect URI it shows with your identity provider. The client secret is stored encrypted. Providers set up before 2.9 keep the old redirect URI until you turn it off
- **Sign in with SSO automatically:** skip the login form and go to the first provider. The `OIDC_SILENT_LOGIN_DEFAULT` environment variable overrides this

## Permissions

- `sso.manage`: add, edit and remove SSO providers. Only admins have it by default.
