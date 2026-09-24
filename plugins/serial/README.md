# Serial

Serial console access over a device attached to the machine running Termix:
the desktop app talks to it through the backend's `serialport` binding, and a
browser without the desktop app falls back to the Web Serial API.

Bundled with Termix and enabled by default.

## Layout

    manifest.json        id, capabilities and what this plugin contributes
    src/backend/          activate(ctx) / deactivate(), the /console WS route
    src/frontend/          the rail panel, the tab and their shared transport
    locales/en.json       its strings (English only; the rest are translated)
    tests/backend/         vitest, node
    tests/frontend/        vitest, jsdom

## Native dependency

`serialport` (and its native `@serialport/bindings-cpp` binding) is this
plugin's own npm dependency rather than a host-provided one, but the build
never bundles it: see "native dependencies" in
packages/plugin-sdk/ARCHITECTURE.md for why, and how Docker, Electron and dev
each end up with a working binary anyway.

## Commands

    npm run build     bundle into dist/
    npm run test      run this plugin's tests
    npm run typecheck

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
