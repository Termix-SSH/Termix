import { afterEach, describe, expect, it } from "vitest";
import { FEED_URL } from "../../src/backend/announcements.js";
import { addChannel, startServer, WEBHOOK, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("permissions", () => {
  it("refuses a user without alerts.use", async () => {
    server = await startServer({ permissions: [] });
    for (const [method, path] of [
      ["GET", "/items"],
      ["GET", "/channels"],
      ["POST", "/channels"],
      ["GET", "/rules"],
    ]) {
      expect((await server.request(method, path, { body: {} })).status).toBe(
        403,
      );
    }
  });
});

describe("channels", () => {
  it("creates, reads back, updates and deletes a channel", async () => {
    server = await startServer();
    const id = await addChannel(server, {
      name: "pager",
      type: "ntfy",
      config: { url: "https://ntfy.sh", topic: "ops", token: "tk_1" },
    });

    const list = await server.request("GET", "/channels");
    expect(list.body).toEqual([
      expect.objectContaining({
        id,
        name: "pager",
        type: "ntfy",
        enabled: true,
        usable: true,
      }),
    ]);
    expect(list.body[0].config).toBeUndefined();

    const detail = await server.request("GET", `/channels/${id}`);
    expect(detail.body.config).toEqual({
      url: "https://ntfy.sh",
      topic: "ops",
      token: "tk_1",
    });

    // Stored sealed, never as plain JSON.
    const stored = server.db.sqlite
      .prepare("SELECT config FROM p_alerts_channels WHERE id = ?")
      .get(id) as { config: string };
    expect(stored.config).not.toContain("tk_1");

    const renamed = await server.request("PUT", `/channels/${id}`, {
      body: { name: "night pager" },
    });
    expect(renamed.body).toMatchObject({ name: "night pager", type: "ntfy" });
    expect(renamed.body.config.token).toBe("tk_1");

    expect((await server.request("DELETE", `/channels/${id}`)).status).toBe(
      200,
    );
    expect((await server.request("GET", "/channels")).body).toEqual([]);
  });

  it("refuses a config that cannot send", async () => {
    server = await startServer();
    for (const body of [
      { name: "", type: "webhook", config: { url: "https://a.example" } },
      { name: "x", type: "sms", config: {} },
      { name: "x", type: "webhook", config: { url: "ftp://a.example" } },
      { name: "x", type: "ntfy", config: { url: "https://ntfy.sh" } },
      {
        name: "x",
        type: "discord",
        config: { url: "https://example.com/api/webhooks/1" },
      },
      { name: "x", type: "email", config: { to: "not an address" } },
    ]) {
      const response = await server.request("POST", "/channels", { body });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("keeps each user's channels to themselves", async () => {
    server = await startServer();
    const id = await addChannel(server, WEBHOOK);
    for (const [method, path] of [
      ["GET", `/channels/${id}`],
      ["PUT", `/channels/${id}`],
      ["DELETE", `/channels/${id}`],
      ["POST", `/channels/${id}/test`],
    ]) {
      const response = await server.request(method, path, {
        user: "bob",
        body: { name: "mine" },
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(
      (await server.request("GET", "/channels", { user: "bob" })).body,
    ).toEqual([]);
  });

  it("sends a test and reports why one failed", async () => {
    server = await startServer({
      respond: (url) =>
        url.includes("down")
          ? new Response("", { status: 502, statusText: "Bad Gateway" })
          : new Response("ok"),
    });
    const good = await addChannel(server, WEBHOOK);
    const bad = await addChannel(server, {
      ...WEBHOOK,
      config: { url: "https://down.example" },
    });

    expect(
      (await server.request("POST", `/channels/${good}/test`)).body,
    ).toEqual({ success: true });
    expect(
      (await server.request("POST", `/channels/${bad}/test`)).body,
    ).toEqual({ success: false, error: "HTTP 502 Bad Gateway" });
  });

  it("says email is unavailable until SMTP is set up", async () => {
    server = await startServer();
    expect((await server.request("GET", "/meta")).body).toEqual({
      emailAvailable: false,
      channelTypes: ["webhook", "ntfy", "discord", "email"],
    });
    await server.mock.ctx.settings.set("smtpHost", "smtp.example");
    await server.mock.ctx.settings.set("smtpFrom", "alerts@example.com");
    expect((await server.request("GET", "/meta")).body.emailAvailable).toBe(
      true,
    );
  });
});

describe("inbox", () => {
  async function seed(s: TestServer) {
    for (const title of ["one", "two", "three"]) {
      await s.hub.deliver({
        source: "docker",
        recipients: ["alice"],
        notification: {
          title,
          severity: title === "two" ? "critical" : "info",
        },
      });
    }
    await s.hub.deliver({
      source: "docker",
      recipients: ["bob"],
      notification: { title: "bob only" },
    });
  }

  it("lists newest first, filters and pages", async () => {
    server = await startServer();
    await seed(server);

    const all = await server.request("GET", "/items");
    expect(all.body.unread).toBe(3);
    expect(all.body.items.map((item: { title: string }) => item.title)).toEqual(
      ["three", "two", "one"],
    );

    const critical = await server.request("GET", "/items?severity=critical");
    expect(
      critical.body.items.map((item: { title: string }) => item.title),
    ).toEqual(["two"]);

    const page = await server.request(
      "GET",
      `/items?limit=1&before=${all.body.items[0].id}`,
    );
    expect(
      page.body.items.map((item: { title: string }) => item.title),
    ).toEqual(["two"]);
  });

  it("marks read and unread, and counts what is left", async () => {
    server = await startServer();
    await seed(server);
    const { items } = (await server.request("GET", "/items")).body;

    const read = await server.request("POST", "/items/read", {
      body: { ids: [items[0].id] },
    });
    expect(read.body).toEqual({ count: 2 });

    const unread = await server.request("GET", "/items?unread=true");
    expect(unread.body.items).toHaveLength(2);

    await server.request("POST", "/items/read", {
      body: { ids: [items[0].id], read: false },
    });
    expect((await server.request("GET", "/unread")).body).toEqual({
      count: 3,
    });

    await server.request("POST", "/items/read", { body: { all: true } });
    expect((await server.request("GET", "/unread")).body).toEqual({
      count: 0,
    });
    // Bob's alert is his own.
    expect(
      (await server.request("GET", "/unread", { user: "bob" })).body,
    ).toEqual({ count: 1 });
  });

  it("deletes one alert, then every read one", async () => {
    server = await startServer();
    await seed(server);
    const { items } = (await server.request("GET", "/items")).body;

    expect(
      (await server.request("DELETE", `/items/${items[0].id}`, { user: "bob" }))
        .status,
    ).toBe(404);
    await server.request("DELETE", `/items/${items[0].id}`);
    await server.request("POST", "/items/read", {
      body: { ids: [items[1].id] },
    });

    expect((await server.request("DELETE", "/items?read=true")).body).toEqual({
      removed: 1,
    });
    expect(
      (await server.request("GET", "/items")).body.items.map(
        (item: { title: string }) => item.title,
      ),
    ).toEqual(["one"]);
  });

  it("lists the categories a user has alerts from", async () => {
    server = await startServer();
    await server.hub.deliver({
      source: "acme-ssl",
      recipients: ["alice"],
      notification: { title: "x", category: "acme-ssl.renewal_failed" },
    });
    expect((await server.request("GET", "/categories")).body).toEqual([
      { source: "acme-ssl", category: "acme-ssl.renewal_failed" },
    ]);
  });
});

describe("rules", () => {
  it("creates, updates and deletes a rule over the user's own channels", async () => {
    server = await startServer();
    const mine = await addChannel(server, WEBHOOK);
    const theirs = await addChannel(server, WEBHOOK, "bob");

    expect(
      (
        await server.request("POST", "/rules", {
          body: { name: "All", channelIds: [theirs] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("POST", "/rules", {
          body: { name: "All", channelIds: [] },
        })
      ).status,
    ).toBe(400);

    const created = await server.request("POST", "/rules", {
      body: { name: "All", channelIds: [mine] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "All",
      match: "*",
      minSeverity: "warning",
      channelIds: [mine],
      enabled: true,
    });

    await server.request("PUT", `/rules/${created.body.id}`, {
      body: {
        name: "Docker",
        match: "docker.*",
        minSeverity: "critical",
        channelIds: [mine],
        enabled: false,
      },
    });
    expect((await server.request("GET", "/rules")).body).toEqual([
      {
        id: created.body.id,
        name: "Docker",
        match: "docker.*",
        minSeverity: "critical",
        channelIds: [mine],
        enabled: false,
      },
    ]);
    expect(
      (
        await server.request("DELETE", `/rules/${created.body.id}`, {
          user: "bob",
        })
      ).status,
    ).toBe(404);
    await server.request("DELETE", `/rules/${created.body.id}`);
    expect((await server.request("GET", "/rules")).body).toEqual([]);
  });

  it("drops a deleted channel from the rules that named it", async () => {
    server = await startServer();
    const a = await addChannel(server, WEBHOOK);
    const b = await addChannel(server, { ...WEBHOOK, name: "b" });
    await server.request("POST", "/rules", {
      body: { name: "Both", channelIds: [a, b] },
    });

    await server.request("DELETE", `/channels/${a}`);

    expect((await server.request("GET", "/rules")).body[0].channelIds).toEqual([
      b,
    ]);
  });
});

describe("announcements", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const feed = [
    {
      id: "release-2-9",
      title: "Termix 2.9 is out",
      message: "Plugins are here.",
      expiresAt: future,
      type: "success",
      actionUrl: "https://termix.site/blog",
      actionText: "Read more",
    },
    {
      id: "old",
      title: "Gone",
      message: "Expired",
      expiresAt: past,
    },
  ];
  const respond = (url: string) =>
    url === FEED_URL ? Response.json(feed) : new Response("ok");

  it("brings each live announcement into the inbox once", async () => {
    server = await startServer({ respond });

    const first = await server.request("GET", "/items");
    expect(first.body.items).toEqual([
      expect.objectContaining({
        source: "termix",
        category: "termix.announcement",
        severity: "success",
        title: "Termix 2.9 is out",
        body: "Plugins are here.",
        link: { url: "https://termix.site/blog" },
        context: { announcementId: "release-2-9", actionText: "Read more" },
      }),
    ]);

    await server.request("POST", "/items/read", { body: { all: true } });
    const again = await server.request("GET", "/items");
    expect(again.body.items).toHaveLength(1);
    expect(again.body.unread).toBe(0);
  });

  it("never brings back one the user deleted", async () => {
    server = await startServer({ respond });
    const { items } = (await server.request("GET", "/items")).body;

    await server.request("DELETE", `/items/${items[0].id}`);

    expect((await server.request("GET", "/items")).body.items).toEqual([]);
    expect(
      server.db.sqlite.prepare("SELECT alert_id FROM p_alerts_dismissed").all(),
    ).toEqual([{ alert_id: "release-2-9" }]);
  });

  it("shows none while an admin has them turned off", async () => {
    server = await startServer({ respond, settings: { announcements: false } });
    expect((await server.request("GET", "/items")).body.items).toEqual([]);
    expect(server.fetches).toEqual([]);
  });
});

describe("the event stream", () => {
  it("sends the unread count, then each new alert", async () => {
    server = await startServer();
    const controller = new AbortController();
    const response = await fetch(`${server.url}/stream`, {
      headers: { "x-test-user": "alice" },
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil('"count":0');
    expect(text).toContain("event: unread");

    await server.hub.deliver({
      source: "docker",
      recipients: ["alice"],
      notification: { title: "Live one" },
    });
    await readUntil("Live one");
    await readUntil('"count":1');
    expect(text).toContain("event: item");
    controller.abort();
  });
});
