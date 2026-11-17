import { EventEmitter } from "node:events";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { drizzleTableName } from "../../../../plugins/sandbox/child/table-name.js";
import { Endpoint } from "../../../../plugins/sandbox/rpc.js";

describe("drizzleTableName", () => {
  it("names a Drizzle table", () => {
    const table = sqliteTable("p_demo_items", { id: integer("id") });
    expect(drizzleTableName(table)).toBe("p_demo_items");
  });

  it("skips plain and prototype-less objects", () => {
    expect(drizzleTableName({ a: 1 })).toBeUndefined();
    expect(drizzleTableName(Object.create(null))).toBeUndefined();
  });

  it("lets a socket with listeners cross as an argument", () => {
    const socket = new EventEmitter();
    socket.on("close", () => {});
    const endpoint = new Endpoint(
      { send() {}, onMessage() {}, onClose() {} } as never,
      {
        side: "c",
        marshalHook: (value: object) => {
          const name = drizzleTableName(value);
          return name ? { $table: name } : undefined;
        },
      } as never,
    );
    expect(() => endpoint.marshal([{ socket }])).not.toThrow();
  });
});
