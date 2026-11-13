/**
 * The launcher relay: core asks its parent to start a plugin process and
 * every message to and from it goes through the parent channel.
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { setParentTarget } from "../../../utils/parent-channel.js";
import {
  relaySpawner,
  SANDBOX_MESSAGE,
} from "../../../plugins/sandbox/spawn.js";

function fakeParent() {
  const sent: Record<string, unknown>[] = [];
  const emitter = new EventEmitter();
  setParentTarget({
    send: (message: unknown) => {
      sent.push(message as Record<string, unknown>);
      return true;
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
  });
  return {
    sent,
    reply: (m: Record<string, unknown>) => emitter.emit("message", m),
  };
}

afterEach(() => setParentTarget(null));

const request = {
  pluginId: "docker",
  runtimePath: "/rt.js",
  execArgv: ["--permission"],
  env: { NODE_ENV: "test", TERMIX_SANDBOX_PLUGIN: "docker" },
  dataDir: "/data/plugin-data/docker",
  firewall: "deny" as const,
};

describe("relay spawner", () => {
  it("asks the launcher, then relays messages, output and exit", async () => {
    const parent = fakeParent();
    const spawner = relaySpawner("launcher");
    const pending = spawner.spawn(request);
    await new Promise((r) => setImmediate(r));
    const ask = parent.sent[0];
    expect(ask).toMatchObject({
      type: SANDBOX_MESSAGE,
      op: "spawn",
      pluginId: "docker",
    });
    parent.reply({ type: SANDBOX_MESSAGE, op: "spawned", id: ask.id, pid: 77 });
    const child = await pending;
    expect(child.pid).toBe(77);

    const wires: unknown[] = [];
    child.transport.onMessage((m) => wires.push(m));
    child.transport.send({ t: "rel", f: "x" });
    expect(parent.sent[1]).toMatchObject({
      op: "msg",
      id: ask.id,
      m: { t: "rel", f: "x" },
    });
    parent.reply({
      type: SANDBOX_MESSAGE,
      op: "msg",
      id: ask.id,
      m: { t: "rel", f: "y" },
    });
    expect(wires).toEqual([{ t: "rel", f: "y" }]);

    const lines: string[] = [];
    child.onOutput((_s, line) => lines.push(line));
    parent.reply({
      type: SANDBOX_MESSAGE,
      op: "log",
      id: ask.id,
      stream: "out",
      line: "hi",
    });
    expect(lines).toEqual(["hi"]);

    let exited: number | null | undefined;
    child.onExit((code) => {
      exited = code;
    });
    child.kill();
    expect(parent.sent.at(-1)).toMatchObject({ op: "kill", id: ask.id });
    parent.reply({ type: SANDBOX_MESSAGE, op: "exit", id: ask.id, code: 0 });
    expect(exited).toBe(0);
  });

  it("fails when the launcher refuses", async () => {
    const parent = fakeParent();
    const pending = relaySpawner("launcher").spawn(request);
    await new Promise((r) => setImmediate(r));
    parent.reply({
      type: SANDBOX_MESSAGE,
      op: "error",
      id: parent.sent[0].id,
      message: "flag --inspect is not allowed",
    });
    await expect(pending).rejects.toThrow(/--inspect/);
  });

  it("ignores replies for other ids and other message types", async () => {
    const parent = fakeParent();
    const pending = relaySpawner("launcher").spawn(request);
    await new Promise((r) => setImmediate(r));
    parent.reply({ type: "backend-response", id: parent.sent[0].id });
    parent.reply({ type: SANDBOX_MESSAGE, op: "spawned", id: "someone-else" });
    parent.reply({
      type: SANDBOX_MESSAGE,
      op: "spawned",
      id: parent.sent[0].id,
      pid: 1,
    });
    await expect(pending).resolves.toMatchObject({ pid: 1 });
  });
});
