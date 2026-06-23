export interface SerialHandle {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
  sendInput: (data: string) => void;
}
