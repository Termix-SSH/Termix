# OPKSSH

Connect to hosts with short-lived SSH certificates from OpenPubkey SSH, after signing in with your identity provider.

## Features

- Adds the OPKSSH login type to the host editor.
- Signs you in with your identity provider in the browser and gets a short-lived SSH certificate from [OpenPubkey SSH](https://github.com/openpubkey/opkssh).
- Keeps the certificate for 24 hours.

## Setup

The config file lives at `<DATA_DIR>/plugins/opkssh/config.yml` and uses the OPKSSH config format. A template is written there the first time someone signs in without one. Installs upgraded from 2.8 have their old `<DATA_DIR>/.opk/config.yml` copied here.

`redirect_uris` in that file is the local listener OPKSSH opens on the Termix server. It must be localhost or left out. Register the public callback shown in the admin settings with your identity provider instead.

### Binary

The plugin runs one pinned release of `opkssh` and checks its SHA-256. It looks for the binary in this order:

1. `OPKSSH_BUNDLED_DIR/<asset>`, which defaults to `<cwd>/opkssh-bundled`. The Docker image ships it at `/app/opkssh-bundled`, so offline installs never download it.
2. `<DATA_DIR>/plugins/opkssh/bin/<asset>`, a copy downloaded earlier.
3. A download from the GitHub release.

A copy with the wrong checksum is ignored. Set `OPKSSH_VERSION` to use another release, and `OPKSSH_SHA256` to its checksum.

## Settings

### Admin

- Redirect URI: register `<base URL>/plugin-api/opkssh/callback` with your identity provider.
- Use the old redirect URI: keep sending the 2.8 URI `<base URL>/host/opkssh-callback`. Upgraded installs keep this on until you turn it off.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
