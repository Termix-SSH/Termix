import { describe, expect, it } from "vitest";
import { getCredentialRowHeight } from "@/sidebar/credential-tree/credential-row-height";

const shapes = [
  { alwaysShowActions: false, actionsOnly: false, isOpen: false },
  { alwaysShowActions: false, actionsOnly: false, isOpen: true },
  { alwaysShowActions: false, actionsOnly: true, isOpen: false },
  { alwaysShowActions: true, actionsOnly: false, isOpen: false },
];

describe("getCredentialRowHeight", () => {
  it.each([
    ["comfortable", 18.5],
    ["compact", 12.5],
  ] as const)(
    "reserves the %s tag row for every row shape",
    (density, extra) => {
      for (const shape of shapes) {
        for (const isKey of [false, true]) {
          const base = getCredentialRowHeight({
            density,
            isKey,
            ...shape,
            showTags: false,
            tagCount: 1,
          });
          const tagged = getCredentialRowHeight({
            density,
            isKey,
            ...shape,
            showTags: true,
            tagCount: 1,
          });
          expect(tagged - base).toBe(extra);
        }
      }
    },
  );

  it("does not reserve space when tags are hidden or absent", () => {
    const base = getCredentialRowHeight({
      density: "comfortable",
      isKey: true,
      ...shapes[0],
      showTags: false,
      tagCount: 0,
    });
    expect(
      getCredentialRowHeight({
        density: "comfortable",
        isKey: true,
        ...shapes[0],
        showTags: true,
        tagCount: 0,
      }),
    ).toBe(base);
  });
});
