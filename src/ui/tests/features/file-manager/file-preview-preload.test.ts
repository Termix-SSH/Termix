import { describe, expect, it } from "vitest";
import { resolveFilePreviewKind } from "../../../features/file-manager/file-preview-preload";

describe("resolveFilePreviewKind", () => {
  it.each([
    ["photo.webp", "image"],
    ["movie.webm", "video"],
    ["voice.m4a", "audio"],
    ["README.md", "markdown"],
    ["manual.pdf", "pdf"],
    ["notes.txt", "text"],
    ["app.tsx", "code"],
    ["Dockerfile", "code"],
    ["LICENSE", "unknown"],
  ] as const)("classifies %s as %s", (filename, expected) => {
    expect(resolveFilePreviewKind(filename)).toBe(expected);
  });
});
