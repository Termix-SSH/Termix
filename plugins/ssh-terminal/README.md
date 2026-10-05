<div align="center">

<img src="https://raw.githubusercontent.com/Termix-SSH/Termix/main/public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>SSH Terminal</h1>

<p>A full SSH terminal in your browser, desktop and phone</p>

</div>

<br />

## Overview

SSH Terminal is the terminal in Termix. It opens SSH sessions in tabs and split screen, and the desktop app also gets a local terminal.

<br />

## Features

- Tabs and split screen
- Jump hosts and host key verification
- Sessions stay alive after a disconnect and reconnect on their own
- Tmux and Mosh support
- Themes, fonts and syntax highlighting
- A toolbar with live stats and quick links to the host's other tools
- Command history with autocomplete
- Macros that automate logins and prompts
- Send keystrokes to several terminals at once
- A local terminal in the desktop app

<br />

## Services

Provides to other plugins:

- `sessions.live` as `ssh`: find a live terminal session so it can be shared
- `terminal.history`: read a user's command history

Uses from other plugins:

- `tmux.sessions` to attach to tmux. Optional
- `sessions.sharing` for shared sessions. Optional
- `recordings.writer` to record sessions. Optional

<br />

## Support

To report a bug or request a feature, open a [support ticket](https://github.com/Termix-SSH/Support/issues/new/choose). You need to be logged in to GitHub. Please be as detailed as possible, preferably in English.

For discussions and questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Distributed under the Apache License Version 2.0. See [LICENSE](https://github.com/Termix-SSH/Termix/blob/main/LICENSE) for more information.
