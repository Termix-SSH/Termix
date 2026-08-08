# Terminal image handoff

Termix terminals can upload an image from a browser file picker or the browser
clipboard and insert a reviewable prompt into the active terminal input. This is
useful when the terminal is running a local multimodal agent, such as Hermes,
inside a TTY or tmux session.

The terminal corner contains three stable controls:

- `tmux:detach`
- `upload image`
- `paste image`

The detach control is disabled when the terminal is not attached to tmux. The
image prompt is inserted into the active terminal but is not submitted
automatically.

## Docker configuration

The backend needs two paths when Termix runs in a container:

- `TERMIX_IMAGE_DIR`: path where the Termix backend writes files.
- `TERMIX_IMAGE_HOST_PATH`: path inserted into the terminal prompt. This must
  be the path visible to the local agent that will inspect the image.

Example Docker configuration:

```yaml
services:
  termix:
    image: ghcr.io/lukegus/termix:latest
    environment:
      TERMIX_IMAGE_DIR: /host-tmp/termix-image-v0
      TERMIX_IMAGE_HOST_PATH: /tmp/termix-image-v0
      TERMIX_IMAGE_TTL_MS: 3600000
      TERMIX_MAX_IMAGE_COUNT: 100
      TERMIX_MAX_IMAGE_STORAGE_BYTES: 5368709120
    volumes:
      - termix-data:/app/data
      - /tmp:/host-tmp
```

With this mapping:

```text
host:      /tmp/termix-image-v0/<uuid>.png
container: /host-tmp/termix-image-v0/<uuid>.png
prompt:    Please inspect this image: /tmp/termix-image-v0/<uuid>.png
```

The path in `TERMIX_IMAGE_HOST_PATH` must be readable from the agent's point
of view. A path that exists only inside the Termix container will produce a
successful upload but an unusable inspection prompt.

If Termix and the agent run directly on the same host without a container, the
values can be the same host-visible path, for example:

```text
TERMIX_IMAGE_DIR=/tmp/termix-image-v0
TERMIX_IMAGE_HOST_PATH=/tmp/termix-image-v0
```

## Limits and validation

The upload endpoint requires the normal authenticated Termix data-access
permissions.

- Multipart request limit: 50 MB.
- Decoded image pixel limit: 40 million pixels by default.
- Active image count: 100 by default.
- Active image storage: 5 GiB by default.
- Image TTL: one hour by default.
- Stored output: normalized PNG with a UUID filename.
- SVG is not accepted as a decoded input format.

The image bytes are validated with Sharp. Browser MIME metadata is not treated
as authoritative, so missing or opaque browser MIME types do not by themselves
reject a file. The backend validates the actual bytes and format instead.

Storage limits can be changed with:

```text
TERMIX_IMAGE_TTL_MS=3600000
TERMIX_MAX_IMAGE_COUNT=100
TERMIX_MAX_IMAGE_STORAGE_BYTES=5368709120
```

Expired files are cleaned during upload. Capacity checks and writes are
serialized so concurrent uploads cannot bypass the count or byte limits.

## Clipboard behavior

Clipboard access requires a secure browser context and a user gesture. The
browser may expose clipboard content as PNG, WebP, SVG, or another browser-
specific image type.

When supported, Termix rasterizes the clipboard image to PNG in the browser
before uploading it. If browser rasterization is unavailable, the original blob
is sent and Sharp performs the server-side validation.

If the browser denies clipboard permission or `navigator.clipboard.read()` is
unavailable, use the file-picker button instead.

## Troubleshooting

### The upload returns 400

The UI should display a diagnostic code. Common codes are:

- `IMAGE_FILE_MISSING`: no multipart field named `image` arrived.
- `IMAGE_MULTIPART_INVALID`: the multipart request was malformed.
- `IMAGE_FORMAT_UNSUPPORTED`: Sharp decoded a format outside the allowlist.
- `IMAGE_DECODE_FAILED`: Sharp could not decode or normalize the image.
- `LIMIT_FILE_SIZE`: the multipart payload exceeded 50 MB.

Check the Termix backend log for the matching upload operation. A 507 response
with `Image storage limit reached` means the configured image count or byte cap
has been reached; it is not an image-format failure.

### The upload succeeds but the agent cannot inspect the path

Check the path from both perspectives:

```bash
# Host / agent perspective
stat /tmp/termix-image-v0/<uuid>.png

# Container perspective
docker exec termix stat /host-tmp/termix-image-v0/<uuid>.png
```

If the container-side file exists under `/app/data/termix-image-v0` while the
host-side `/tmp/termix-image-v0` file does not exist, the container is using the
wrong `TERMIX_IMAGE_DIR`. Configure the `/host-tmp` mapping shown above and
restart the backend.

### Clipboard paste does nothing

Check all of the following:

- The page is served over HTTPS or from a browser-approved secure context.
- The paste button is clicked directly by the user.
- Browser clipboard permission is granted.
- The clipboard contains an image item, not only text.
- A hard refresh loaded the current frontend bundle after deployment.

### Large phone screenshots fail behind HTTPS

Both HTTP and HTTPS nginx server blocks must set the 50 MB body limit. If only
the HTTP configuration was updated, nginx's default 1 MB limit can reject a
phone screenshot before the request reaches the Termix backend.

## Security and lifecycle

The endpoint is protected by authentication and data-access middleware. Uploaded
content is decoded and re-encoded to PNG before storage, user-controlled names
are not used for stored filenames, and generated files are removed after the
configured TTL. The prompt is inserted into the terminal input but is never
submitted automatically by the image handoff feature.
