import { describe, expect, it } from "vitest";
import {
  AI_TOOLS,
  FORBIDDEN_DOMAINS,
  getTool,
  listToolNames,
  toolDefinitions,
} from "../../ai/tools/catalog.js";

/**
 * The security regression test for the whole feature.
 *
 * Tools run in-process and never pass through the RBAC-gated routers, so "the
 * assistant cannot reach credentials or user administration" is a property of
 * this catalog, and nothing else. If a future change adds a tool that touches a
 * forbidden domain, this test is what catches it.
 */
describe("AI tool catalog", () => {
  it("exposes no tool naming a forbidden domain", () => {
    for (const tool of AI_TOOLS) {
      for (const domain of FORBIDDEN_DOMAINS) {
        expect(
          tool.name.includes(domain),
          `${tool.name} references the forbidden domain "${domain}"`,
        ).toBe(false);
      }
    }
  });

  it("has no tool that could read a credential", () => {
    const banned = [
      "get_credential",
      "list_credentials",
      "get_password",
      "get_private_key",
      "get_api_key",
      "create_user",
      "delete_user",
      "grant_permission",
      "update_settings",
    ];
    for (const name of banned) {
      expect(getTool(name), `${name} must not exist`).toBeUndefined();
    }
  });

  it("only allows read or propose categories", () => {
    for (const tool of AI_TOOLS) {
      expect(["read", "propose"]).toContain(tool.category);
    }
  });

  it("names every tool by its category", () => {
    // A propose tool that does not say "propose" would read as a direct action
    // in the transcript, which is exactly the confusion this feature avoids.
    for (const tool of AI_TOOLS) {
      if (tool.category === "propose") {
        expect(
          tool.name.startsWith("propose_"),
          `${tool.name} is a propose tool but is not named propose_*`,
        ).toBe(true);
      } else {
        expect(
          tool.name.startsWith("propose_"),
          `${tool.name} is a read tool but is named propose_*`,
        ).toBe(false);
      }
    }
  });

  it("has unique tool names", () => {
    const names = listToolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a described object schema", () => {
    for (const definition of toolDefinitions()) {
      expect(definition.description.length, definition.name).toBeGreaterThan(
        20,
      );
      expect(definition.parameters.type, definition.name).toBe("object");
      // additionalProperties:false keeps a model from smuggling extra fields
      // past the handler's explicit reads.
      expect(definition.parameters.additionalProperties, definition.name).toBe(
        false,
      );
    }
  });

  it("never takes a userId from the model", () => {
    // Ownership is always derived from the verified JWT. A userId parameter
    // would let the model ask for another account's data.
    for (const tool of AI_TOOLS) {
      const properties = (tool.parameters.properties ?? {}) as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(properties)) {
        expect(
          /^user_?id$/i.test(key),
          `${tool.name} accepts a model-supplied ${key}`,
        ).toBe(false);
      }
    }
  });

  it("still offers the read tools the assistant needs to be useful", () => {
    for (const name of ["list_hosts", "list_snippets", "list_automations"]) {
      expect(getTool(name), name).toBeDefined();
    }
  });
});
