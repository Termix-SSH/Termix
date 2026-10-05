# Contributing to Wake-on-LAN

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

- **MAC address:** the network card to wake
- **Broadcast address:** where to send the packet. Leave it blank for 255.255.255.255

## Permissions

- `wake-on-lan.send`: send Wake-on-LAN packets. Admins and users have it by default.
