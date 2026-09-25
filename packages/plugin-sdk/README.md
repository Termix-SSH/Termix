# @termix/plugin-sdk

Everything a [Termix](https://github.com/Termix-SSH/Termix) plugin builds
against: the types for `activate(ctx)` and `activate(app)`, table
definitions, the manifest schema, test helpers, a vitest preset and the
`termix-plugin` CLI.

```bash
npm install --save-dev @termix/plugin-sdk
npx termix-plugin build      # bundle dist/backend.js and dist/frontend.js
npx termix-plugin test       # run the plugin's vitest suite
npx termix-plugin validate   # check manifest.json and the files it names
npx termix-plugin pack       # write <id>-<version>.tmxplug
npx termix-plugin sign <file.tmxplug>   # needs TERMIX_PLUGIN_SIGNING_KEY
```

Start from
[Termix-Plugin-Template](https://github.com/Termix-SSH/Termix-Plugin-Template).
The full contract is in [ARCHITECTURE.md](./ARCHITECTURE.md).
