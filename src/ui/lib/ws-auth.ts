const JWT_PROTOCOL_PREFIX = "termix.jwt.";

export function websocketAuthProtocols(token: string | null): string[] {
  return token ? [`${JWT_PROTOCOL_PREFIX}${token}`] : [];
}
