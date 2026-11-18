import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import axios from "axios";
import { checkFrameViews } from "@/plugin-host/testing-host";
import { frameRoute } from "@/plugin-host/testing-frame-views";

const manifest = {
  id: "gizmo",
  name: "Gizmo",
  version: "1.0.0",
  contributes: { tabs: [{ id: "gizmo" }], panels: [] },
};

type App = {
  registerTab: (...args: unknown[]) => void;
  registerSlotContribution: (...args: unknown[]) => void;
  registerAction: (...args: unknown[]) => void;
};

function Fetcher({ paths }: { paths: string[] }) {
  useEffect(() => {
    for (const path of paths) void fetch(path).catch(() => {});
  }, [paths]);
  return <div>gizmo</div>;
}

describe("frameRoute", () => {
  it("sorts own routes, allowed core reads and refused requests", () => {
    expect(frameRoute("gizmo", "GET", "/plugin-api/gizmo/items").kind).toBe(
      "own",
    );
    expect(frameRoute("gizmo", "GET", "/plugin-api/other/items").kind).toBe(
      "refused",
    );
    expect(
      frameRoute("gizmo", "GET", "/__termix_api/30001/users/me").kind,
    ).toBe("core");
    expect(frameRoute("gizmo", "GET", "/users/list").kind).toBe("refused");
    expect(
      frameRoute("gizmo", "POST", "http://localhost/operations/approvals/1")
        .kind,
    ).toBe("refused");
  });
});

describe("checkFrameViews", () => {
  it("reports the core requests a frame would be refused", async () => {
    const result = await checkFrameViews(
      {
        activate: (app: never) => {
          const a = app as App;
          a.registerTab("gizmo", () => (
            <Fetcher
              paths={[
                "/plugin-api/gizmo/items",
                "/__termix_api/30001/users/me",
                "/__termix_api/30001/users/list",
              ]}
            />
          ));
          a.registerAction("gizmo.row", () => {});
          a.registerSlotContribution("dashboard.hostRow", {
            actionId: "gizmo.row",
            titleKey: "row",
            kind: "component",
            component: () => <Fetcher paths={["/plugin-api/vault/x"]} />,
          });
        },
      },
      { manifest },
    );
    expect(result.problems).toEqual([]);
    expect(result.rendered).toEqual([
      "tab:gizmo",
      "slot:dashboard.hostRow:gizmo.row",
    ]);
    expect(result.refused).toEqual([
      "GET /plugin-api/vault/x",
      "GET /users/list",
    ]);
  });

  it("checks axios requests too and gives back the real network", async () => {
    const realFetch = globalThis.fetch;
    const result = await checkFrameViews(
      {
        activate: (app: never) => {
          (app as App).registerTab("gizmo", () => {
            useEffect(() => {
              void axios.post("/host/db/host", {}).catch(() => {});
            }, []);
            return null;
          });
        },
      },
      { manifest, settleMs: 100 },
    );
    expect(result.refused).toEqual(["POST /host/db/host"]);
    expect(globalThis.fetch).toBe(realFetch);
  });

  it("answers allowed requests with the test's data", async () => {
    let seen: unknown = null;
    await checkFrameViews(
      {
        activate: (app: never) => {
          (app as App).registerTab("gizmo", () => {
            useEffect(() => {
              void fetch("/plugin-api/gizmo/count")
                .then((response) => response.json())
                .then((body) => {
                  seen = body;
                });
            }, []);
            return null;
          });
        },
      },
      {
        manifest,
        respond: (method, path) => ({ method, path }),
      },
    );
    expect(seen).toEqual({ method: "GET", path: "/plugin-api/gizmo/count" });
  });
});
