# Terminal Toolbar and Image Handoff

Termix includes a context-aware toolbar for connected SSH terminals. The
toolbar provides quick actions without requiring a separate tab or command.

## Terminal toolbar

The toolbar appears near the bottom of a connected terminal when the terminal
toolbar is enabled for the host.

Available actions depend on the host and the current terminal context. Common
actions include:

- Open the remote File Manager.
- Open terminal-related tools and host actions.
- Detach from the current tmux session.
- Upload an image from the local device.
- Paste an image from the browser clipboard.

The toolbar can be collapsed to a compact button. Its density can also cycle
between:

- Icon mode: compact controls with tooltips.
- Labeled mode: icons with action labels.
- Expanded mode: labeled controls plus host CPU, memory, and disk indicators
  when metrics are available.

The selected density is remembered in the browser for the current Termix
instance. Unfocused split panes use compact controls to preserve space.

## Upload an image

1. Open a connected SSH terminal.
2. Select the upload-image action in the terminal toolbar.
3. Choose an image from the local device.
4. Termix uploads the image to the remote host and inserts the resulting remote
   path into the active terminal.

The inserted path can then be used by a terminal agent or shell command that
needs to inspect or process the image.

The upload control accepts browser-supported image files. Uploading is disabled
while another image upload is in progress.

## Paste an image

1. Copy an image to the browser or operating system clipboard.
2. Open a connected SSH terminal in Termix.
3. Select the paste-image action in the terminal toolbar.

Termix uploads the clipboard image to the remote host and inserts the resulting
remote path into the active terminal.

Clipboard access depends on browser permissions and platform support. If the
browser does not provide a readable image from the clipboard, use the upload
image action instead.

## Disconnected terminals

Image actions require an active terminal connection. If the terminal is not
connected, Termix cannot insert the remote path into the shell. Reconnect the
terminal and retry the action.

## Security and storage

Images are transferred through the authenticated Termix terminal upload flow
and stored on the remote host. The resulting path is sent to the active
terminal session; it is not a public URL.

Use the same host permissions and storage practices that you use for other
files uploaded to a remote server. Remove uploaded files from the remote host
when they are no longer needed.
