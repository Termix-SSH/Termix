declare module "guacamole-common-js" {
  namespace Guacamole {
    class Client {
      constructor(tunnel: Tunnel);
      connect(data?: string): void;
      disconnect(): void;
      getDisplay(): Display;
      sendKeyEvent(pressed: number, keysym: number): void;
      sendMouseState(state: Mouse.State): void;
      setClipboard(stream: OutputStream, mimetype: string): void;
      createClipboardStream(mimetype: string): OutputStream;
      onstatechange: ((state: number) => void) | null;
      onerror: ((error: Status) => void) | null;
      onclipboard: ((stream: InputStream, mimetype: string) => void) | null;
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
          down?: boolean
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
    }

    class Keyboard {
      constructor(element: Document | HTMLElement);
      onkeydown: ((keysym: number) => void) | null;
      onkeyup: ((keysym: number) => void) | null;
    }

    class Status {
      code: number;
      message: string;
      isError(): boolean;
    }

    class InputStream {
      onblob: ((data: string) => void) | null;
      onend: (() => void) | null;
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
  }

  export default Guacamole;
}

