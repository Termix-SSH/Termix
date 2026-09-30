import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { createMeetingApi } from "./meeting-api";

export type MeetingBackend = Awaited<ReturnType<typeof connectMeetings>>;

/** A room, its hosts and its sockets must all belong to the same backend. */
export async function connectMeetings(app: TermixApp) {
  const remoteUrl = app.desktop.available
    ? await app.desktop.remoteServerUrl()
    : null;
  const key = remoteUrl?.replace(/\/+$/, "") || "local";
  const origin = remoteUrl ? ("remote" as const) : ("local" as const);
  const publicUrl =
    remoteUrl || (!app.desktop.available ? window.location.href : null);
  const assertCurrent = async () => {
    const current = app.desktop.available
      ? await app.desktop.remoteServerUrl()
      : null;
    if ((current?.replace(/\/+$/, "") || "local") !== key) {
      throw new Error(app.t("collab.serverChanged"));
    }
  };
  return {
    key,
    origin,
    publicUrl,
    assertCurrent,
    api: createMeetingApi(app.apiFor(origin), assertCurrent),
  };
}

export function meetingGuestUrl(
  publicUrl: string | null,
  token: string,
): string | null {
  if (!publicUrl) return null;
  const url = new URL(publicUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "collab-guest");
  url.searchParams.set("token", token);
  return url.toString();
}
