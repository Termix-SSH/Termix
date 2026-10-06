<div align="center">

<img src="https://raw.githubusercontent.com/Termix-SSH/Termix/main/public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix Plugin SDK</h1>

<p>Everything you need to build a Termix plugin</p>

</div>

<br />

## Overview

`@termix-ssh/plugin-sdk` is what every [Termix](https://github.com/Termix-SSH/Termix) plugin builds against, including the ones that ship with Termix. It has the types for a plugin's backend and frontend, table definitions, the manifest schema, test helpers, and the `termix-plugin` CLI. The easiest way to start is the [Termix Plugin Template](https://github.com/Termix-SSH/Termix-Plugin-Template).

<br />

## Installation

```bash
npm install --save-dev @termix-ssh/plugin-sdk
```

<br />

## CLI

```bash
npx termix-plugin build                  # bundle dist/backend.js and dist/frontend.js
npx termix-plugin test                   # run the plugin's Vitest suite
npx termix-plugin validate               # check manifest.json and the files it names
npx termix-plugin migrations             # write migrations from the table definitions
npx termix-plugin pack                   # write <id>-<version>.tmxplug
npx termix-plugin sign <file.tmxplug>    # sign it, needs TERMIX_PLUGIN_SIGNING_KEY
npx termix-plugin verify <file.tmxplug> --key <base64>   # check a signature
npx termix-plugin keygen --out <dir>     # make a new signing key pair
npx termix-plugin dev --server <url> --key <tmx_...>   # install on a server and reinstall on every change
```

`dev` needs developer mode on (Admin settings, Plugins) and an API key from an
admin account. It installs the plugin from a file, marked unverified, and
reinstalls it each time you save. `TERMIX_SERVER_URL` and `TERMIX_API_KEY` work
in place of the flags. Reload the page to pick up frontend changes.

<br />

## Support

To report a bug or request a feature, open a [support ticket](https://github.com/Termix-SSH/Support/issues/new/choose). You need to be logged in to GitHub. Please be as detailed as possible, preferably in English.

For discussions and questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Distributed under the Apache License Version 2.0. See [LICENSE](https://github.com/Termix-SSH/Termix/blob/main/LICENSE) for more information.
