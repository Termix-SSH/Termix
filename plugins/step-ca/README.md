# Step CA

Adds the `stepca` SSH auth type: Termix signs you in with the identity
provider behind a [smallstep step-ca](https://smallstep.com/docs/step-ca/)
OIDC provisioner, has the CA sign a fresh key, and keeps the short-lived SSH
certificate until it expires.

Termix never runs the `step` binary. It talks to the CA's HTTPS API
(`/root/<fingerprint>`, `/provisioners`, `/1.0/ssh/sign`) and to the identity
provider directly, through core's outbound request guard.

## Settings

Admin settings, under Settings > Plugins > Step CA:

- **CA URL**, **Root fingerprint** and **OIDC provisioner name**. Leave all
  three empty to turn Step CA off.
- **Allowed private Step CA hosts**: the CA and, if it is internal, the
  identity provider. Anything private that is not listed is refused.
- **Redirect URI**: register it with the identity provider:
  `<base URL>/plugin-api/step-ca/callback`, or
  `<base URL>/host/step-ca-callback` while "Use the old redirect URI" is on.

An install upgraded from 2.8 has its Step CA settings copied in and keeps
the old redirect URI turned on.

## Several instances

With `REDIS_URL` set, a callback that reaches another Termix instance is
handed to the one that started the sign-in. `TERMIX_STEP_CA_REDIS_PREFIX`
changes the key prefix (default `termix:step-ca`).
