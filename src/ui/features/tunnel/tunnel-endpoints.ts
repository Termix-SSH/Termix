type EndpointHostLike = {
  id: number | string;
  name?: string;
  ip: string;
  username?: string;
};

export function findHostByTunnelEndpoint<T extends EndpointHostLike>(
  hosts: T[],
  endpointHost?: string | null,
): T | undefined {
  const value = endpointHost?.trim();
  if (!value) return undefined;

  return hosts.find((host) => {
    const id = String(host.id);
    const userAtIp = host.username ? `${host.username}@${host.ip}` : "";
    return (
      id === value ||
      host.name === value ||
      host.ip === value ||
      userAtIp === value
    );
  });
}
