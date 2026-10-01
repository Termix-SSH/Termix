export type SerialConfig = {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
};

export interface SerialHandle {
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  isConnected: () => boolean;
  sendInput: (data: string) => void;
}
