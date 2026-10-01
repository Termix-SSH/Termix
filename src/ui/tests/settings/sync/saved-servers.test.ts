import { afterEach, describe, expect, it } from "vitest";
import {
  forgetServerUrl,
  getSavedServerUrls,
  rememberServerUrl,
} from "@/settings/sync/saved-servers";

afterEach(() => localStorage.clear());

describe("saved server urls", () => {
  it("keeps the newest five, without duplicates or trailing slashes", () => {
    for (let i = 1; i <= 6; i++) rememberServerUrl(`https://s${i}.example/`);
    rememberServerUrl("https://s4.example");
    expect(getSavedServerUrls()).toEqual([
      "https://s4.example",
      "https://s6.example",
      "https://s5.example",
      "https://s3.example",
      "https://s2.example",
    ]);
  });

  it("forgets a server and survives bad storage", () => {
    rememberServerUrl("https://a.example");
    expect(forgetServerUrl("https://a.example")).toEqual([]);
    localStorage.setItem("termix_saved_server_urls", "{broken");
    expect(getSavedServerUrls()).toEqual([]);
  });
});
