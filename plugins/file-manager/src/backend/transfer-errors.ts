export class TransferCancelledError extends Error {
  constructor() {
    super("Transfer cancelled");
    this.name = "TransferCancelledError";
  }
}

export class TransferStalledError extends Error {
  readonly byteOffset?: number;
  readonly segmentIndex?: number;

  constructor(byteOffset?: number, segmentIndex?: number) {
    const pos = byteOffset !== undefined ? ` at byte offset ${byteOffset}` : "";
    const seg = segmentIndex !== undefined ? ` (segment ${segmentIndex})` : "";
    super(`Transfer stalled — no data moved for 45 seconds${pos}${seg}`);
    this.name = "TransferStalledError";
    this.byteOffset = byteOffset;
    this.segmentIndex = segmentIndex;
  }
}

export class TransferConnectionLostError extends Error {
  constructor(message = "Transfer SSH connection lost") {
    super(message);
    this.name = "TransferConnectionLostError";
  }
}

export function isRecoverableTransferConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("no response from server") ||
    msg.includes("connection lost") ||
    msg.includes("not connected") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("protocol error") ||
    msg.includes("connection closed") ||
    msg.includes("channel open failure")
  );
}

export function isRecoverableTransferError(err: unknown): boolean {
  return (
    err instanceof TransferStalledError ||
    err instanceof TransferConnectionLostError ||
    isRecoverableTransferConnectionError(err)
  );
}
