declare module "guacamole-common-js" {
  namespace Guacamole {
    class Client {
      constructor(tunnel: Tunnel);
      connect(data?: string): void;
      disconnect(): void;
      getDisplay(): Display;
      sendKeyEvent(pressed: number, keysym: number): void;
      sendMouseState(state: Mouse.State): void;
      sendSize(width: number, height: number): void;
      setClipboard(stream: OutputStream, mimetype: string): void;
      createClipboardStream(mimetype: string): OutputStream;
      onstatechange: ((state: number) => void) | null;
      onerror: ((error: Status) => void) | null;
      onclipboard: ((stream: InputStream, mimetype: string) => void) | null;
      onaudio: ((stream: InputStream, mimetype: string) => void) | null;
      onfile:
        | ((stream: InputStream, mimetype: string, filename: string) => void)
        | null;
      onfilesystem: ((filesystem: Object, name: string) => void) | null;
    }

    // Mirrors Guacamole.Object: a named collection of streams. Within this
    // namespace `Object` refers to this class, not the global one.
    class Object {
      static readonly ROOT_STREAM: string;
      static readonly STREAM_INDEX_MIMETYPE: string;
      readonly index: number;
      requestInputStream(
        name: string,
        bodyCallback?: (stream: InputStream, mimetype: string) => void,
      ): void;
      createOutputStream(mimetype: string, name: string): OutputStream;
      onbody: ((stream: InputStream, mimetype: string) => void) | null;
      onundefine: (() => void) | null;
    }

    class AudioPlayer {
      static getInstance(
        stream: InputStream,
        mimetype: string,
      ): AudioPlayer | null;
      sync(): void;
    }

    class Display {
      getElement(): HTMLElement;
      getWidth(): number;
      getHeight(): number;
      scale(scale: number): void;
      onresize: (() => void) | null;
    }

    class Tunnel {
      onerror: ((status: Status) => void) | null;
      onstatechange: ((state: number) => void) | null;
    }

    class WebSocketTunnel extends Tunnel {
      constructor(url: string);
    }

    class SessionRecording {
      constructor(source: Blob | Tunnel, refreshInterval?: number);
      onload: (() => void) | null;
      onerror: ((message: string) => void) | null;
      onprogress: ((duration: number, parsedSize: number) => void) | null;
      onplay: (() => void) | null;
      onpause: (() => void) | null;
      onseek:
        ((position: number, current: number, total: number) => void) | null;
      getDisplay(): Display;
      getPosition(): number;
      getDuration(): number;
      isPlaying(): boolean;
      play(): void;
      pause(): void;
      seek(position: number, callback?: () => void): void;
      abort(): void;
    }

    class Mouse {
      constructor(element: HTMLElement);
      onmousedown: ((state: Mouse.State) => void) | null;
      onmouseup: ((state: Mouse.State) => void) | null;
      onmousemove: ((state: Mouse.State) => void) | null;
      onmouseout: ((state: Mouse.State) => void) | null;
    }

    namespace Mouse {
      class State {
        constructor(
          x: number,
          y: number,
          left?: boolean,
          middle?: boolean,
          right?: boolean,
          up?: boolean,
          down?: boolean,
        );
        constructor(state: {
          x: number;
          y: number;
          left?: boolean;
          middle?: boolean;
          right?: boolean;
          up?: boolean;
          down?: boolean;
        });
        x: number;
        y: number;
        left: boolean;
        middle: boolean;
        right: boolean;
        up: boolean;
        down: boolean;
      }

      interface MouseEvent {
        state: Mouse.State;
        preventDefault(): void;
        stopPropagation(): void;
      }

      class Touchpad {
        constructor(element: HTMLElement);
        currentState: Mouse.State;
        clickTimingThreshold: number;
        clickMoveThreshold: number;
        scrollThreshold: number;
        onEach(
          types: string[],
          listener: (event: Mouse.MouseEvent) => void,
        ): void;
        on(type: string, listener: (event: Mouse.MouseEvent) => void): void;
      }

      class Touchscreen {
        constructor(element: HTMLElement);
        currentState: Mouse.State;
        clickTimingThreshold: number;
        clickMoveThreshold: number;
        scrollThreshold: number;
        longPressThreshold: number;
        onEach(
          types: string[],
          listener: (event: Mouse.MouseEvent) => void,
        ): void;
        on(type: string, listener: (event: Mouse.MouseEvent) => void): void;
      }
    }

    class Keyboard {
      constructor(element: Document | HTMLElement);
      reset(): void;
      onkeydown: ((keysym: number) => void) | null;
      onkeyup: ((keysym: number) => void) | null;
    }

    class Status {
      code: number;
      message: string;
      isError(): boolean;
      static readonly Code: {
        SUCCESS: number;
        UNSUPPORTED: number;
        SERVER_ERROR: number;
        SERVER_BUSY: number;
        UPSTREAM_TIMEOUT: number;
        UPSTREAM_ERROR: number;
        RESOURCE_NOT_FOUND: number;
        RESOURCE_CONFLICT: number;
        RESOURCE_CLOSED: number;
        CLIENT_BAD_REQUEST: number;
        CLIENT_UNAUTHORIZED: number;
        CLIENT_FORBIDDEN: number;
        CLIENT_TIMEOUT: number;
      };
    }

    class InputStream {
      onblob: ((data: string) => void) | null;
      onend: (() => void) | null;
      sendAck(message: string, code: number): void;
    }

    class OutputStream {
      sendBlob(data: string): void;
      sendEnd(): void;
    }

    class StringReader {
      constructor(stream: InputStream);
      ontext: ((text: string) => void) | null;
      onend: (() => void) | null;
    }

    class StringWriter {
      constructor(stream: OutputStream);
      sendText(text: string): void;
      sendEnd(): void;
    }

    class BlobReader {
      constructor(stream: InputStream, mimetype: string);
      getBlob(): Blob;
      getLength(): number;
      onprogress: ((length: number) => void) | null;
      onend: (() => void) | null;
    }

    class BlobWriter {
      constructor(stream: OutputStream);
      sendBlob(blob: Blob): void;
      sendEnd(): void;
      onack: ((status: Status) => void) | null;
      onerror: ((blob: Blob, offset: number, error: Status) => void) | null;
      onprogress: ((blob: Blob, offset: number) => void) | null;
      oncomplete: ((blob: Blob) => void) | null;
    }
  }

  export default Guacamole;
}
