# Step CA

Connect to hosts with short-lived SSH certificates from a smallstep step-ca server, after signing in through its OIDC provisioner.

## Features

- Adds the Step CA login type to the host editor.
- Signs you in through the identity provider behind a [smallstep step-ca](https://smallstep.com/docs/step-ca/) OIDC provisioner.
- Has the CA sign a fresh key and keeps the certificate until it expires.
- Talks to the CA's HTTPS API directly, so the `step` binary is never needed.

## Setup

When `REDIS_URL` is set and you run more than one Termix instance, a callback that reaches the wrong instance is handed to the one that started the sign-in. `TERMIX_STEP_CA_REDIS_PREFIX` changes the key prefix, which defaults to `termix:step-ca`.

## Settings

### Admin

- CA URL, Root fingerprint and OIDC provisioner name: leave all three empty to turn Step CA off.
- Allowed private Step CA hosts: the CA and, if it is internal, the identity provider. Private hosts not on this list are refused.
- Redirect URI: register `<base URL>/plugin-api/step-ca/callback` with your identity provider.
- Use the old redirect URI: keep sending the 2.8 URI `<base URL>/host/step-ca-callback`. Upgraded installs keep this on until you turn it off.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
