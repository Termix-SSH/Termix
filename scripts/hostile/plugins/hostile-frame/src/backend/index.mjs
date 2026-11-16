// Keeps what the frame reports so the runner can read it.
export async function activate(ctx) {
  const reports = {};
  const router = ctx.http.router();
  router.get("/config", async (_req, res) => {
    res.json({ exfilOrigin: (await ctx.settings.get("exfilOrigin")) || "" });
  });
  router.post("/report", async (req, res) => {
    const { role, results } = req.body ?? {};
    if (typeof role === "string" && results && typeof results === "object") {
      reports[role] = { at: Date.now(), results };
    }
    res.json({ ok: true });
  });
  router.get("/report", (_req, res) => {
    res.json(reports);
  });
  // The runner says when the shell is ready for the frame to open its view.
  let go = false;
  router.post("/go", (_req, res) => {
    go = true;
    res.json({ ok: true });
  });
  router.get("/go", (_req, res) => {
    res.json({ go });
  });
  router.get("/ping", (_req, res) => {
    res.json({ ok: true, plugin: "hostile-frame" });
  });
}
