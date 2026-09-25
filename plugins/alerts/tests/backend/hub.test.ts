import { afterEach, describe, expect, it, vi } from "vitest";
import { addChannel, startServer, WEBHOOK, type TestServer } from "./helpers";

const mail = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("../../src/backend/mail.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/backend/mail.js")
  >("../../src/backend/mail.js");
  return {
    ...actual,
    sendMail: async (smtp: unknown, message: unknown) => {
      mail.sent.push({ smtp, message });
    },
  };
});

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  mail.sent.length = 0;
});

const inbox = async (s: TestServer, user = "alice") =>
  (await s.request("GET", "/items", { user })).body;

describe("the alert hub", () => {
  it("puts an alert in each recipient's inbox with safe defaults", async () => {
    server = await startServer();
    const result = await server.hub.deliver({
      source: "docker",
      recipients: ["alice", "bob", "alice"],
      notification: {
        title: "Container stopped",
        body: "web exited",
        link: { tab: "docker", url: "javascript:alert(1)" },
      },
    });

    expect(result).toEqual({ recipients: 2, delivered: 0, failures: [] });
    for (const user of ["alice", "bob"]) {
      const { items, unread } = await inbox(server, user);
      expect(unread).toBe(1);
      expect(items).toEqual([
        expect.objectContaining({
          source: "docker",
          category: "docker",
          severity: "warning",
          title: "Container stopped",
          body: "web exited",
          link: { tab: "docker" },
          readAt: null,
        }),
      ]);
    }
  });

  it("drops a repeat while the first is still unread", async () => {
    server = await startServer();
    const send = () =>
      server!.hub.deliver({
        source: "acme-ssl",
        recipients: ["alice"],
        notification: { title: "Renewal failed", dedupeKey: "renew:a" },
      });

    expect((await send()).recipients).toBe(1);
    expect((await send()).recipients).toBe(0);
    expect((await inbox(server)).items).toHaveLength(1);

    await server.request("POST", "/items/read", { body: { all: true } });
    expect((await send()).recipients).toBe(1);
    expect((await inbox(server)).items).toHaveLength(2);
  });

  it("sends to the channels a matching rule names, and records how it went", async () => {
    server = await startServer({
      respond: (url) =>
        url.includes("broken")
          ? new Response("nope", { status: 500, statusText: "Server Error" })
          : new Response("ok"),
    });
    const ops = await addChannel(server, WEBHOOK);
    const broken = await addChannel(server, {
      ...WEBHOOK,
      name: "broken",
      config: { url: "https://broken.example/hook" },
    });
    const quiet = await addChannel(server, {
      ...WEBHOOK,
      name: "quiet",
      config: { url: "https://quiet.example/hook" },
    });
    await server.request("POST", "/rules", {
      body: {
        name: "Docker",
        match: "docker.*",
        minSeverity: "warning",
        channelIds: [ops, broken],
      },
    });
    await server.request("POST", "/rules", {
      body: {
        name: "Only critical",
        match: "*",
        minSeverity: "critical",
        channelIds: [quiet],
      },
    });

    const result = await server.hub.deliver({
      source: "docker",
      recipients: ["alice"],
      notification: {
        title: "Container stopped",
        category: "docker.container_stopped",
        severity: "warning",
      },
    });

    expect(result.delivered).toBe(1);
    expect(result.failures).toEqual([
      {
        channelId: broken,
        name: "broken",
        error: "HTTP 500 Server Error: nope",
      },
    ]);
    expect(server.fetches.map((call) => call.url)).toEqual([
      "https://hooks.example/alert",
      "https://broken.example/hook",
    ]);
    const body = JSON.parse(server.fetches[0].init!.body as string);
    expect(body).toMatchObject({
      title: "Container stopped",
      severity: "warning",
      category: "docker.container_stopped",
      source: "docker",
    });
    const [item] = (await inbox(server)).items;
    expect(item.deliveries).toEqual([
      { channelId: ops, name: "ops", ok: true },
      {
        channelId: broken,
        name: "broken",
        ok: false,
        error: "HTTP 500 Server Error: nope",
      },
    ]);
  });

  it("adds the channels a sender names, but only the recipient's own", async () => {
    server = await startServer();
    const mine = await addChannel(server, WEBHOOK);
    const theirs = await addChannel(
      server,
      { ...WEBHOOK, config: { url: "https://bob.example/hook" } },
      "bob",
    );

    const result = await server.hub.deliver({
      source: "automations",
      recipients: ["alice"],
      notification: { title: "Ping", channelIds: [mine, theirs] },
    });

    expect(result.delivered).toBe(1);
    expect(server.fetches.map((call) => call.url)).toEqual([
      "https://hooks.example/alert",
    ]);
  });

  it("skips a disabled channel", async () => {
    server = await startServer();
    const id = await addChannel(server, WEBHOOK);
    await server.request("PUT", `/channels/${id}`, {
      body: { enabled: false },
    });

    const result = await server.hub.deliver({
      source: "automations",
      recipients: ["alice"],
      notification: { title: "Ping", channelIds: [id] },
    });

    expect(result.delivered).toBe(0);
    expect(server.fetches).toEqual([]);
  });

  it("reaches a private address only with the opt-in and the admin allowlist", async () => {
    server = await startServer({
      coreSettings: {
        notification_private_endpoint_allowlist: JSON.stringify(["NTFY.LAN"]),
      },
    });
    const open = await addChannel(server, {
      name: "lan",
      type: "ntfy",
      config: {
        url: "http://ntfy.lan",
        topic: "alerts",
        allowPrivateNetwork: true,
      },
    });
    const closed = await addChannel(server, {
      name: "lan2",
      type: "ntfy",
      config: { url: "http://ntfy.lan", topic: "other" },
    });

    await server.hub.deliver({
      source: "automations",
      recipients: ["alice"],
      notification: { title: "Ping", channelIds: [open, closed] },
    });

    expect(server.fetches.map((call) => call.init?.allowPrivateHosts)).toEqual([
      ["ntfy.lan"],
      [],
    ]);
  });

  it("emails through the admin's SMTP server", async () => {
    server = await startServer({
      settings: {
        smtpHost: "smtp.example",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "termix",
        smtpPassword: "pw",
        smtpFrom: "Termix <alerts@example.com>",
      },
    });
    const id = await addChannel(server, {
      name: "mail",
      type: "email",
      config: { to: "ops@example.com, oncall@example.com" },
    });

    const result = await server.hub.deliver({
      source: "automations",
      recipients: ["alice"],
      notification: {
        title: "Disk full",
        body: "/data at 99%",
        channelIds: [id],
        link: { url: "https://termix.example/hosts/1" },
      },
    });

    expect(result.delivered).toBe(1);
    expect(mail.sent).toEqual([
      {
        smtp: {
          host: "smtp.example",
          port: 465,
          secure: true,
          user: "termix",
          password: "pw",
          from: "Termix <alerts@example.com>",
        },
        message: {
          to: ["ops@example.com", "oncall@example.com"],
          subject: "[Termix] Disk full",
          text: "/data at 99%\n\nhttps://termix.example/hosts/1",
        },
      },
    ]);
  });

  it("reports an email channel as failed while SMTP is not set up", async () => {
    server = await startServer({
      settings: {
        smtpHost: "smtp.example",
        smtpFrom: "alerts@example.com",
      },
    });
    const id = await addChannel(server, {
      name: "mail",
      type: "email",
      config: { to: "ops@example.com" },
    });
    await server.mock.ctx.settings.set("smtpHost", "");

    const result = await server.hub.deliver({
      source: "automations",
      recipients: ["alice"],
      notification: { title: "Disk full", channelIds: [id] },
    });

    expect(result.failures).toEqual([
      {
        channelId: id,
        name: "mail",
        error: "Email is not set up on this server",
      },
    ]);
  });

  it("lists a user's channels without their config", async () => {
    server = await startServer();
    const id = await addChannel(server, WEBHOOK);
    expect(await server.hub.channels("alice")).toEqual([
      { id, name: "ops", type: "webhook", enabled: true },
    ]);
    expect(await server.hub.channels("bob")).toEqual([]);
  });

  it("wipes everything a user had when their data is wiped", async () => {
    server = await startServer();
    await addChannel(server, WEBHOOK);
    await server.hub.deliver({
      source: "docker",
      recipients: ["alice", "bob"],
      notification: { title: "x" },
    });

    server.mock.ctx.events.emit("user.data_wiped", { userId: "alice" });

    await vi.waitFor(async () =>
      expect((await inbox(server!)).items).toEqual([]),
    );
    expect(await server.hub.channels("alice")).toEqual([]);
    expect((await inbox(server, "bob")).items).toHaveLength(1);
  });
});
