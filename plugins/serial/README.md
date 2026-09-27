# Serial

Open a serial console to a device plugged into your computer.

## Features

- Open a serial console to a device plugged into your computer.
- The desktop app talks to the device directly.
- In a browser, the plugin uses Web Serial.

## Setup

The desktop app uses the `serialport` npm package, which has a native binary. The build does not bundle it. See "native dependencies" in `packages/plugin-sdk/ARCHITECTURE.md` for how Docker, Electron and dev each get a working copy.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
