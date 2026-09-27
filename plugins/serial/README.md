# Serial

Open a serial console to a device plugged into your computer.

## Features

- Open a serial console to a device plugged into your computer.
- The desktop app talks to the device directly.
- In a browser, the plugin uses Web Serial.

## Setup

The desktop app uses the `serialport` npm package, which has a native binary. The build does not bundle it.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
