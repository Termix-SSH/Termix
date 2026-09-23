# Web Endpoint

Opens a host's web UI from Termix, either directly or through an SSH tunnel, in an
embedded tab or an isolated desktop window.

Each host can define up to 16 endpoints (`MAX_WEB_ENDPOINTS`). An endpoint is either:

- **direct** — the browser loads `scheme://host:port/path` itself, or
- **tunnel** — the backend opens a local SSH forward to the target port and the frame
  loads it over loopback.

## Layout

| Path                                  | What it is                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `backend/index.mjs`                   | Plugin entry: `activate` starts the service, `deactivate` stops it.    |
| `backend/routes.ts`                   | `POST /open` — opens or reuses the forward and returns the bound port. |
| `frontend/WebEndpointTab.tsx`         | The embedded viewer (a `credentialless` sandboxed iframe).             |
| `frontend/web-endpoint-api.ts`        | Client for the open route plus the Electron bridges.                   |
| `frontend/web-endpoint-url.ts`        | URL building and the cookie/reachability refusal rules.                |
| `frontend/web-endpoint-validation.ts` | Editor-side mirror of the backend normalizer.                          |

## What stays in core

This plugin owns its lifecycle, not all of its code. Three pieces deliberately stay in
Termix proper:

- **`host-web-endpoints.ts`** (`src/backend/database/routes/`). Despite sitting in
  `routes/` it has no router — it is the `webUiConfig` normalizer, imported by `host.ts`,
  `host-bulk-routes.ts` and `host-normalizers.ts` to sanitize the column on every host
  save and list. Disabling this plugin must not stop that validation, and core cannot
  import plugin code in any case.
- **The Electron half** (`electron/web-endpoint-window.cjs` plus the
  `open-isolated-web-endpoint` and `allow-invalid-certificate-for-origin` handlers in
  `main.cjs`). `BrowserWindow` and `session` are main-process-only, the renderer is what
  invokes those channels, and the main process loads no plugin code today.
- **`HostEditorWebUiSection.tsx`** (`src/ui/sidebar/`). It is a section inside the host
  editor's General tab and takes the core-owned `{ form, setField }` pair, the same
  reason docker leaves `HostDockerTab` in core.

The `enableWebUi` and `webUiConfig` columns stay on core's `ssh_data` table, declared
here through `contributes.hostCapability`.

## Tunnels

A tunnel endpoint opens through the tunnels plugin, a hard dependency. `POST /open`
calls `forward()` on its `tunnels.access` service, which connects through core's SSH
pipeline, binds the local listener, probes the target once and only then returns the
bound port. The forward runs under the reserved `web:<hostId>:<endpointId>` name, so
the tunnels plugin never retries it and closes it after ten idle minutes.

## Routing

Core mounts the route at `/plugin-api/web-endpoint/open` through `ctx.http.router()`,
which the generic `/plugin-api/` block in both nginx configs already proxies.

## Tests

Backend tests are in `src/backend/tests/plugins/web-endpoint/` (the backend vitest
project only globs `src/backend/**`). Frontend tests sit beside the source here, which
the frontend project picks up via `plugins/**/frontend/**/*.test.{ts,tsx}`.

`web-endpoint-validation.test.ts` deliberately imports the backend normalizer as well as
the editor one and runs both over the same samples, so the two implementations cannot
drift.
