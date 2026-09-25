# OPKSSH

Adds the `opkssh` SSH auth type: Termix signs you in with your identity
provider in the browser, gets a short-lived SSH certificate from
[OpenPubkey SSH](https://github.com/openpubkey/opkssh), and caches it for 24
hours.

## Config

`<DATA_DIR>/plugins/opkssh/config.yml`, OPKSSH's own config format. A
template is written there the first time someone signs in without one. An
install upgraded from 2.8 has its old `<DATA_DIR>/.opk/config.yml` copied
here.

`redirect_uris` in that file are OPKSSH's local listener on the Termix
server and must be localhost (or left out). The public callback is passed
to OPKSSH as `--remote-redirect-uri`; register it with your identity
provider. The plugin's admin settings page shows it:
`<base URL>/plugin-api/opkssh/callback`, or `<base URL>/host/opkssh-callback`
while "Use the old redirect URI" is on.

## Binary

The plugin runs `opkssh` pinned to one release and its SHA-256. It looks, in
order, at:

1. `OPKSSH_BUNDLED_DIR/<asset>` (default `<cwd>/opkssh-bundled`). The Docker
   image bakes the binary into `/app/opkssh-bundled`, so offline installs
   never download it.
2. `<DATA_DIR>/plugins/opkssh/bin/<asset>`, a copy downloaded earlier.
3. A download from the GitHub release.

Any copy whose checksum does not match is ignored. `OPKSSH_VERSION` picks
another release; `OPKSSH_SHA256` must then give its checksum.
