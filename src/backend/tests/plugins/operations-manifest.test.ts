import { describe, expect, it } from "vitest";
import { parseManifest } from "@termix-ssh/plugin-sdk/manifest";
import {
  invokeAllowed,
  matchesWhen,
  onSurface,
  parseOperationInput,
  redactFields,
  toJsonSchema,
  type OperationAction,
  type OperationField,
} from "@termix-ssh/plugin-sdk/operations";

const action = (overrides: Partial<OperationAction> = {}): OperationAction => ({
  id: "demo.allow-port",
  titleKey: "ops.allow",
  scope: "host",
  risk: "change",
  permission: "use",
  hostAccess: "edit",
  ...overrides,
});

function manifest(operations: unknown, capabilities = ["operations:provide"]) {
  return {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    description: "A demo.",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=26.11.1-0", api: "^1.13" },
    capabilities,
    contributes: {
      permissions: [
        { name: "use", titleKey: "perm.use", descriptionKey: "perm.useDesc" },
      ],
      operations,
    },
  };
}

function errorsFor(operations: unknown, capabilities?: string[]): string[] {
  return parseManifest(manifest(operations, capabilities)).errors ?? [];
}

describe("contributes.operations", () => {
  it("accepts a full declaration", () => {
    const errors = errorsFor({
      actions: [
        action({
          check: "demo.port-allowed",
          inputs: [
            { key: "port", type: "number", required: true, min: 1, max: 65535 },
            { key: "name", type: "resource", resource: "demo.rule" },
          ],
        }),
        action({
          id: "demo.port-allowed",
          risk: "read",
          hostAccess: "connect",
        }),
        action({
          id: "demo.list-rules",
          risk: "read",
          hostAccess: "connect",
        }),
      ],
      events: [{ id: "demo.turned-off", titleKey: "e", scope: "host" }],
      resources: [
        {
          id: "demo.rule",
          titleKey: "r",
          list: "demo.list-rules",
          key: "id",
          name: "name",
        },
      ],
      signals: [
        {
          id: "demo.rules",
          titleKey: "s",
          read: "demo.port-allowed",
          scope: "host",
          kind: "count",
          fix: "demo.allow-port",
        },
      ],
    });
    expect(errors).toEqual([]);
  });

  it("needs the capability", () => {
    expect(errorsFor({ actions: [action()] }, [])).toContainEqual(
      expect.stringContaining("operations:provide"),
    );
  });

  it("refuses an id outside the plugin", () => {
    expect(
      errorsFor({ actions: [action({ id: "docker.stop" })] }),
    ).toContainEqual(expect.stringContaining('must start with "demo."'));
  });

  it("refuses a destructive action a connect level user could run", () => {
    expect(
      errorsFor({
        actions: [action({ risk: "destructive", hostAccess: "connect" })],
      }),
    ).toContainEqual(expect.stringContaining("edit or manage"));
  });

  it("lets a change declare its own level", () => {
    expect(errorsFor({ actions: [action({ hostAccess: "connect" })] })).toEqual(
      [],
    );
  });

  it("refuses an undeclared permission", () => {
    expect(
      errorsFor({ actions: [action({ permission: "nope" })] }),
    ).toContainEqual(expect.stringContaining("is not declared"));
  });

  it("refuses a check that is not a read", () => {
    expect(
      errorsFor({
        actions: [
          action({ check: "demo.other" }),
          action({ id: "demo.other" }),
        ],
      }),
    ).toContainEqual(expect.stringContaining("must be a read action"));
  });

  it("refuses references that go nowhere", () => {
    const errors = errorsFor({
      actions: [action({ undo: "demo.gone" })],
      resources: [
        {
          id: "demo.rule",
          titleKey: "r",
          list: "demo.gone",
          key: "id",
          name: "n",
        },
      ],
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses unknown fields", () => {
    expect(
      errorsFor({ actions: [{ ...action(), extra: true }] }),
    ).toContainEqual(expect.stringContaining('Unknown field "extra"'));
  });

  it("refuses a default on a secret", () => {
    expect(
      errorsFor({
        actions: [
          action({
            inputs: [{ key: "token", type: "secret", default: "abc" }],
          }),
        ],
      }),
    ).toContainEqual(expect.stringContaining("not allowed on a secret"));
  });

  it("needs operations:invoke for invokes", () => {
    expect(errorsFor({ invokes: ["docker.*"] }, [])).toContainEqual(
      expect.stringContaining("operations:invoke"),
    );
  });
});

describe("parseOperationInput", () => {
  const fields: OperationField[] = [
    { key: "port", type: "number", required: true, min: 1, max: 65535 },
    {
      key: "proto",
      type: "select",
      default: "tcp",
      options: [
        { value: "tcp", labelKey: "t" },
        { value: "udp", labelKey: "u" },
      ],
    },
    { key: "name", type: "string", pattern: "[a-z]+" },
    { key: "data", type: "json" },
  ];

  it("coerces strings and fills defaults", () => {
    expect(parseOperationInput(fields, { port: "443" })).toEqual({
      values: { port: 443, proto: "tcp" },
      errors: [],
    });
  });

  it("refuses keys no field declares", () => {
    expect(
      parseOperationInput(fields, { port: 1, sudo: true }).errors,
    ).toContainEqual(expect.stringContaining('"sudo"'));
  });

  it("needs required fields", () => {
    expect(parseOperationInput(fields, {}).errors).toEqual([
      '"port" is required',
    ]);
  });

  it("checks bounds, options and the whole pattern", () => {
    expect(parseOperationInput(fields, { port: 0 }).errors).toHaveLength(1);
    expect(
      parseOperationInput(fields, { port: 1, proto: "icmp" }).errors,
    ).toHaveLength(1);
    expect(
      parseOperationInput(fields, { port: 1, name: "abc; rm -rf" }).errors,
    ).toEqual(['"name" has the wrong format']);
  });

  it("parses json strings", () => {
    expect(
      parseOperationInput(fields, { port: 1, data: '{"a":1}' }).values.data,
    ).toEqual({ a: 1 });
  });

  it("refuses a redacted echo for a secret", () => {
    const secret: OperationField[] = [{ key: "token", type: "secret" }];
    expect(
      parseOperationInput(secret, { token: { set: true } }).errors,
    ).toHaveLength(1);
  });

  it("refuses input that is not an object", () => {
    expect(parseOperationInput(fields, "nope").errors).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("redacts secrets and sensitive outputs", () => {
    expect(
      redactFields(
        [
          { key: "token", type: "secret" },
          { key: "conf", type: "textarea", sensitive: true },
          { key: "port", type: "number" },
        ],
        { token: "abc", conf: "key", port: 1 },
      ),
    ).toEqual({ token: "[redacted]", conf: "[redacted]", port: 1 });
  });

  it("builds JSON Schema", () => {
    const schema = toJsonSchema([
      { key: "port", type: "number", required: true, min: 1 },
      { key: "token", type: "secret" },
    ]) as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toEqual(["port"]);
    expect(schema.properties.port).toEqual({ type: "number", minimum: 1 });
    expect(schema.properties.token).toEqual({
      type: "string",
      writeOnly: true,
    });
  });

  it("keeps AI and MCP opt in, the rest opt out", () => {
    expect(onSurface({}, "assistant")).toBe(false);
    expect(onSurface({}, "mcp")).toBe(false);
    expect(onSurface({}, "cli")).toBe(true);
    expect(onSurface({ surfaces: { assistant: true } }, "assistant")).toBe(
      true,
    );
    expect(onSurface({ surfaces: { cli: false } }, "cli")).toBe(false);
  });

  it("matches invokes patterns", () => {
    expect(invokeAllowed(["docker.*"], "docker.stop")).toBe(true);
    expect(invokeAllowed(["docker.*"], "dockerx.stop")).toBe(false);
    expect(invokeAllowed(["docker.stop"], "docker.start")).toBe(false);
    expect(invokeAllowed(["*"], "anything.at-all")).toBe(true);
    expect(invokeAllowed(undefined, "docker.stop")).toBe(false);
  });

  it("tests when against a host", () => {
    const when = { settings: { enableDocker: true }, os: ["linux"] };
    expect(
      matchesWhen(when, { settings: { enableDocker: true }, os: "Linux" }),
    ).toBe(true);
    expect(matchesWhen(when, { settings: {} })).toBe(false);
    expect(
      matchesWhen(when, { settings: { enableDocker: true }, os: "windows" }),
    ).toBe(false);
    expect(matchesWhen(when, { settings: { enableDocker: true } })).toBe(true);
  });
});
