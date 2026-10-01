# Wake-on-LAN

Wake a sleeping host by sending a Wake-on-LAN packet to its MAC address.

## Features

- Wake a sleeping host by sending a Wake-on-LAN packet to its MAC address.
- Automations can wake a host as one of their steps.

## Settings

### Host

- MAC address: the network card to wake.
- Broadcast address: where to send the packet.

## Permissions

- `wake-on-lan.send`: Send Wake-on-LAN packets. Admins and users have it by default.

## Services

Provides to other plugins:

- `wake-on-lan.send`: wake a host.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
