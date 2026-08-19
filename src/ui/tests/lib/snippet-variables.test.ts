import { describe, it, expect } from "vitest";
import {
  extractSnippetInputs,
  hasSnippetInputs,
  resolveSnippetContent,
} from "../../lib/snippet-variables";

describe("extractSnippetInputs", () => {
  it("extracts a single unlabeled input", () => {
    expect(extractSnippetInputs("ping $INPUT_1")).toEqual([
      { key: "INPUT_1", label: "Input 1" },
    ]);
  });

  it("extracts a labeled input using brace syntax", () => {
    expect(
      extractSnippetInputs("nc -zv $HOST ${INPUT_1:Port to check}"),
    ).toEqual([{ key: "INPUT_1", label: "Port to check" }]);
  });

  it("plain (non-braced) references have no label", () => {
    expect(extractSnippetInputs("echo $INPUT_2")).toEqual([
      { key: "INPUT_2", label: "Input 2" },
    ]);
  });

  it("de-duplicates repeated references and preserves first-seen order", () => {
    expect(
      extractSnippetInputs("$INPUT_2 then $INPUT_1 then $INPUT_2 again"),
    ).toEqual([
      { key: "INPUT_2", label: "Input 2" },
      { key: "INPUT_1", label: "Input 1" },
    ]);
  });

  it("returns an empty array when there are no placeholders", () => {
    expect(extractSnippetInputs("uptime")).toEqual([]);
  });
});

describe("hasSnippetInputs", () => {
  it("returns true when a snippet has an input placeholder", () => {
    expect(hasSnippetInputs("echo $INPUT_1")).toBe(true);
  });

  it("returns false when a snippet has no input placeholder", () => {
    expect(hasSnippetInputs("echo $HOST")).toBe(false);
  });
});

describe("resolveSnippetContent", () => {
  const host = { ip: "10.0.0.5", username: "root", port: 22, name: "web-01" };

  it("substitutes host variables", () => {
    expect(
      resolveSnippetContent("ssh $USER@$HOST -p $PORT # $NAME", host),
    ).toBe("ssh root@10.0.0.5 -p 22 # web-01");
  });

  it("supports brace syntax for host variables", () => {
    expect(resolveSnippetContent("ping ${HOST}", host)).toBe("ping 10.0.0.5");
  });

  it("substitutes input placeholders", () => {
    expect(
      resolveSnippetContent("nc -zv $HOST ${INPUT_1:Port}", host, {
        INPUT_1: "8080",
      }),
    ).toBe("nc -zv 10.0.0.5 8080");
  });

  it("leaves host variables literal when no host context is given", () => {
    expect(resolveSnippetContent("ping $HOST", null)).toBe("ping $HOST");
  });

  it("leaves input placeholders literal when no value was supplied", () => {
    expect(resolveSnippetContent("echo $INPUT_1", null)).toBe("echo $INPUT_1");
  });
});
