# Proxmox

Find Proxmox VE guests through an SSH host, import them as hosts and keep them in sync.

## Features

- Find the VMs and containers on a Proxmox VE node through an SSH host you already have.
- Import them as Termix hosts with the login type you choose.
- Keep imported hosts in sync on a schedule.
- Show node and guest stats in the Proxmox tab.

## Settings

### Host

- Proxmox: mark this host as a Proxmox node and set how guests are imported.
- Default Auth Type: the login type given to imported guests.
- Auto sync guests and Sync interval (minutes): check the node for changes on a schedule. The minimum is 5 minutes.
- Proxmox stats: show the stats tab for this host.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
