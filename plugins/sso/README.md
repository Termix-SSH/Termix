# Single sign-on

Sign in with an OpenID Connect provider, GitHub or Google. Each provider gets its own button on the login screen.

## Features

- Sign in with any OpenID Connect provider, GitHub or Google.
- Each provider gets its own button on the login screen.
- Make members of an admin group Termix admins, read from a group claim.
- Supports back-channel logout.

## Settings

### Admin

- Providers: add a provider, then register the redirect URI it shows with your identity provider. Providers set up before 2.9 keep the old redirect URI until you turn it off.

## Permissions

- `sso.manage`: Add, edit and remove SSO providers. Only admins have it by default.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
