# Contributing to Proxmox

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Host

- **Enable Proxmox:** mark this host as a Proxmox node so its guests can be imported
- **Default Auth Type and Default Credential:** the login given to imported guests
- **Windows / RDP detection and Docker detection:** name patterns that switch guests to RDP or turn on Docker
- **Preferred IP ranges:** IP prefixes to prefer, in order
- **Auto sync guests and Sync interval (minutes):** check the node for changes on a schedule, at least every 5 minutes
- **Mark missing guests:** tag guests that disappear as `proxmox-missing` instead of deleting them
- **Enable Proxmox Stats:** show the Proxmox Stats tab for this host
- **Poll interval (seconds):** how often stats refresh, at least 15 seconds
- **Node name override:** use this node name instead of the detected one
