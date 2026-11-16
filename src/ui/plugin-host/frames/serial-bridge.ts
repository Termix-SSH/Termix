/**
 * Web Serial for plugin frames. A frame's origin is opaque, so it cannot use
 * navigator.serial itself. The shell asks the browser for a port (the
 * browser shows its own picker), opens the one the person picked and gives
 * the frame only a handle: bytes in, bytes out, close. A frame never sees
 * other ports, never lists granted ports and can only use its own handles.
 */

const BAUD_RATES = new Set([
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 74880,
  115200, 230400, 250000, 460800, 500000, 921600, 1000000, 1500000, 2000000,
]);
const MAX_WRITE_BYTES = 64 * 1024;
const MAX_PORTS_PER_OWNER = 4;

export interface SerialOpenOptions {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
}

interface WebSerialPort {
  open(options: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface OpenPort {
  port: WebSerialPort;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  onClose: () => void;
  closed: boolean;
}

const owners = new Map<string, Map<string, OpenPort>>();
const picking = new Set<string>();
let handleCount = 0;

function isId(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 0xffff
  );
}

/** The options a frame sent, or null when any part is not allowed. */
export function parseSerialOptions(value: unknown): SerialOpenOptions | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!BAUD_RATES.has(raw.baudRate as number)) return null;
  const dataBits = raw.dataBits ?? 8;
  const stopBits = raw.stopBits ?? 1;
  const parity = raw.parity ?? "none";
  if (dataBits !== 7 && dataBits !== 8) return null;
  if (stopBits !== 1 && stopBits !== 2) return null;
  if (parity !== "none" && parity !== "even" && parity !== "odd") return null;
  const options: SerialOpenOptions = {
    baudRate: raw.baudRate as number,
    dataBits,
    stopBits,
    parity,
  };
  if (raw.filters !== undefined) {
    if (!Array.isArray(raw.filters) || raw.filters.length > 16) return null;
    const filters: NonNullable<SerialOpenOptions["filters"]> = [];
    for (const entry of raw.filters) {
      if (!entry || typeof entry !== "object") return null;
      const { usbVendorId, usbProductId } = entry as Record<string, unknown>;
      if (usbVendorId !== undefined && !isId(usbVendorId)) return null;
      if (usbProductId !== undefined && !isId(usbProductId)) return null;
      if (usbProductId !== undefined && usbVendorId === undefined) return null;
      const filter: { usbVendorId?: number; usbProductId?: number } = {};
      if (isId(usbVendorId)) filter.usbVendorId = usbVendorId;
      if (isId(usbProductId)) filter.usbProductId = usbProductId;
      filters.push(filter);
    }
    options.filters = filters;
  }
  return options;
}

function serialApi(): {
  requestPort(options?: { filters?: unknown[] }): Promise<WebSerialPort>;
} | null {
  if (typeof navigator === "undefined") return null;
  const serial = (navigator as Navigator & { serial?: unknown }).serial;
  return (serial as ReturnType<typeof serialApi>) ?? null;
}

/** Whether this browser has Web Serial at all. */
export function webSerialAvailable(): boolean {
  return serialApi() !== null;
}

// A callback into a frame that is gone rejects; nothing is waiting on it.
function quietly(run: () => unknown): void {
  try {
    void Promise.resolve(run()).catch(() => {});
  } catch {
    // Same.
  }
}

async function shutdown(open: OpenPort): Promise<void> {
  if (open.closed) return;
  open.closed = true;
  try {
    await open.reader?.cancel();
  } catch {
    // Already gone.
  }
  try {
    open.writer?.releaseLock();
  } catch {
    // Already released.
  }
  try {
    await open.port.close();
  } catch {
    // Unplugged ports throw here.
  }
  quietly(() => open.onClose());
}

/**
 * Shows the browser's port picker and opens the picked port. Resolves the
 * handle, or null when the person picked nothing. The caller has checked the
 * plugin may use serial ports and that the person just used its frame.
 */
export async function requestSerialPort(
  owner: string,
  options: SerialOpenOptions,
  onData: (chunk: Uint8Array) => void,
  onClose: () => void,
): Promise<string | null> {
  const api = serialApi();
  if (!api) throw new Error("This browser has no serial port support");
  if (picking.has(owner)) throw new Error("A port picker is already open");
  const ports = owners.get(owner) ?? new Map<string, OpenPort>();
  if (ports.size >= MAX_PORTS_PER_OWNER) {
    throw new Error("Too many serial ports open");
  }
  picking.add(owner);
  let port: WebSerialPort;
  try {
    port = await api.requestPort(
      options.filters?.length ? { filters: options.filters } : {},
    );
  } catch (error) {
    if ((error as { name?: string })?.name === "NotFoundError") return null;
    throw error;
  } finally {
    picking.delete(owner);
  }
  await port.open({
    baudRate: options.baudRate,
    dataBits: options.dataBits,
    stopBits: options.stopBits,
    parity: options.parity,
  });
  const handle = `serial-${++handleCount}`;
  const open: OpenPort = {
    port,
    reader: port.readable?.getReader() ?? null,
    writer: port.writable?.getWriter() ?? null,
    onClose,
    closed: false,
  };
  ports.set(handle, open);
  owners.set(owner, ports);
  void (async () => {
    try {
      for (;;) {
        const result = await open.reader?.read();
        if (!result || result.done) break;
        const chunk = result.value;
        if (chunk?.byteLength) quietly(() => onData(chunk));
      }
    } catch {
      // The port closed or was unplugged.
    } finally {
      ports.delete(handle);
      await shutdown(open);
    }
  })();
  return handle;
}

function portOf(owner: string, handle: unknown): OpenPort {
  const open =
    typeof handle === "string" ? owners.get(owner)?.get(handle) : undefined;
  if (!open || open.closed) throw new Error("Unknown serial port");
  return open;
}

/** Writes bytes to one of the owner's ports. */
export async function writeSerial(
  owner: string,
  handle: unknown,
  data: unknown,
): Promise<void> {
  const open = portOf(owner, handle);
  if (!(data instanceof Uint8Array)) throw new Error("Write bytes only");
  if (data.byteLength > MAX_WRITE_BYTES) throw new Error("Write is too large");
  if (!open.writer) throw new Error("Port is not writable");
  await open.writer.write(data);
}

/** Closes one of the owner's ports. */
export async function closeSerial(
  owner: string,
  handle: unknown,
): Promise<void> {
  if (typeof handle !== "string") return;
  const ports = owners.get(owner);
  const open = ports?.get(handle);
  if (!open) return;
  ports!.delete(handle);
  await shutdown(open);
}

/** Closes every port a frame opened, when it reloads or closes. */
export function closeSerialFor(owner: string): void {
  const ports = owners.get(owner);
  owners.delete(owner);
  picking.delete(owner);
  for (const open of ports?.values() ?? []) void shutdown(open);
}

/** Test seam. */
export function resetSerialBridge(): void {
  for (const owner of [...owners.keys()]) closeSerialFor(owner);
  handleCount = 0;
}
