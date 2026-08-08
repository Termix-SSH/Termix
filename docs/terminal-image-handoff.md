# Terminal image handoff

Termix terminals can upload an image from a browser file picker or the browser
clipboard and insert a reviewable prompt into the active terminal input. This is
useful when the terminal is running a local multimodal agent, such as Hermes,
inside a TTY or tmux session.

The prompt is inserted but is not submitted automatically.

## Configuration

The backend stores uploaded images in `TERMIX_IMAGE_DIR`:

```text
TERMIX_IMAGE_DIR=/host-tmp/termix-image-v0
TERMIX_IMAGE_HOST_PATH=/tmp/termix-image-v0
TERMIX_IMAGE_TTL_MS=3600000
```

- `TERMIX_IMAGE_DIR` is the path visible to the Termix backend.
- `TERMIX_IMAGE_HOST_PATH` is the path inserted into the terminal prompt.
  It must refer to the same files from the agent's perspective.
- `TERMIX_IMAGE_TTL_MS` controls cleanup of old generated images. The default
  is one hour.

For a containerized local agent, mount the host directory into Termix and set
both paths to their corresponding container/host locations. For example:

```yaml
volumes:
  - /tmp:/host-tmp
```

The upload endpoint requires the normal authenticated Termix data-access
permissions. Uploaded content is fully decoded and normalized to PNG before
being stored. Uploads are limited to 50 MB and 40 million decoded pixels by
default.

Clipboard access requires a secure browser context and a user gesture. If the
browser denies clipboard permission, use the file-picker button instead.
