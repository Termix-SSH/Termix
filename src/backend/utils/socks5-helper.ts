// Re-export from proxy-helper for backward compatibility
export {
  createSocks5Connection,
  createProxyConnection,
  createHttpConnectConnection,
  createMixedProxyChainConnection,
  testProxyConnectivity,
} from "./proxy-helper.js";
export type { SOCKS5Config } from "./proxy-helper.js";
