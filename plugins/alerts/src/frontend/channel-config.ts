import type { ChannelDetail, ChannelType } from "../types";

export interface Draft {
  name: string;
  type: ChannelType;
  url: string;
  method: "POST" | "PUT";
  headers: string;
  topic: string;
  token: string;
  username: string;
  avatarUrl: string;
  to: string;
  allowPrivateNetwork: boolean;
}

export const EMPTY: Draft = {
  name: "",
  type: "webhook",
  url: "",
  method: "POST",
  headers: "",
  topic: "",
  token: "",
  username: "",
  avatarUrl: "",
  to: "",
  allowPrivateNetwork: false,
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

export function draftFrom(channel: ChannelDetail): Draft {
  const config = channel.config;
  const headers =
    config.headers && typeof config.headers === "object"
      ? Object.entries(config.headers as Record<string, unknown>)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join("\n")
      : "";
  return {
    ...EMPTY,
    name: channel.name,
    type: channel.type,
    url: str(config.url) || (channel.type === "ntfy" ? "https://ntfy.sh" : ""),
    method: config.method === "PUT" ? "PUT" : "POST",
    headers,
    topic: str(config.topic),
    token: str(config.token),
    username: str(config.username),
    avatarUrl: str(config.avatar_url),
    to: str(config.to),
    allowPrivateNetwork: config.allowPrivateNetwork === true,
  };
}

export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

export function configFrom(draft: Draft): Record<string, unknown> {
  const privateNetwork = draft.allowPrivateNetwork
    ? { allowPrivateNetwork: true }
    : {};
  switch (draft.type) {
    case "webhook": {
      const headers = parseHeaders(draft.headers);
      return {
        url: draft.url.trim(),
        method: draft.method,
        ...(Object.keys(headers).length ? { headers } : {}),
        ...privateNetwork,
      };
    }
    case "ntfy":
      return {
        url: draft.url.trim(),
        topic: draft.topic.trim(),
        ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        ...privateNetwork,
      };
    case "discord":
      return {
        url: draft.url.trim(),
        ...(draft.username.trim() ? { username: draft.username.trim() } : {}),
        ...(draft.avatarUrl.trim()
          ? { avatar_url: draft.avatarUrl.trim() }
          : {}),
      };
    case "email":
      return { to: draft.to.trim() };
  }
}
