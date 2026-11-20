// Logs in with Chromium, lets the hostile frame run, and watches the page
// and the outside origin for anything that got through.
import { call, must } from "../../authz/lib/client.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exfil server path -> leak id.
const LEAK_PATHS = {
  img: "leak.img",
  css: "leak.css",
  import: "leak.css-import",
  font: "leak.font",
  video: "leak.video",
  audio: "leak.audio",
  iframe: "leak.iframe",
  svg: "leak.svg-image",
  prefetch: "leak.prefetch",
  stylesheet: "leak.stylesheet",
  beacon: "leak.beacon",
  fetch: "leak.fetch",
  websocket: "leak.websocket",
  eventsource: "leak.event-source",
  form: "leak.form",
  worker: "leak.worker",
  object: "leak.object",
  popup: "leak.popup",
  topnav: "leak.topnav",
  openurl: "leak.openurl",
  selfnav: "leak.selfnav",
};

// Counts toasts as they appear, before any can leave the screen.
const TOAST_COUNTER = `
  window.__hostileToasts = 0;
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.("[data-sonner-toast]")) window.__hostileToasts++;
        window.__hostileToasts += node.querySelectorAll?.("[data-sonner-toast]").length ?? 0;
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
`;

// Notes when hostile frames come and go, for a failure message.
const FRAME_TIMELINE = `
  window.__hostileFrames = [];
  const start = Date.now();
  const note = (what, node) => {
    if (node.nodeType !== 1 || node.tagName !== "IFRAME") return;
    if (node.dataset.pluginFrame !== "hostile-frame") return;
    window.__hostileFrames.push(
      Math.round((Date.now() - start) / 100) / 10 + "s " + what + " " +
        (node.dataset.frameRole ?? "view"),
    );
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) note("added", node);
      for (const node of record.removedNodes) note("removed", node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
`;

async function finishSetup(page) {
  const button = page
    .getByRole("button", {
      name: /^(Skip setup|Not now|Done|Next)$/,
    })
    .filter({ visible: true });
  const skip = page
    .getByText("Skip setup", { exact: true })
    .filter({ visible: true });
  const allOn = page.getByRole("button", { name: /^Turn all on$/ });
  const stage = page.locator('[data-slot="tab-stage"]');
  const end = Date.now() + 120_000;
  let quietSince = Date.now();
  while (Date.now() < end) {
    // Setup would turn the fixtures off otherwise.
    if (await allOn.count()) {
      await allOn
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      await sleep(300);
    }
    if (await skip.count()) {
      await skip
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      quietSince = Date.now();
      await sleep(500);
      continue;
    }
    if (await button.count()) {
      await button
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      quietSince = Date.now();
      await sleep(500);
      continue;
    }
    if ((await stage.count()) && Date.now() - quietSince > 3000) return;
    await sleep(250);
  }
  throw new Error("The dashboard did not load");
}

/** Whether the hostile background frame sits on top of the shell. */
async function takenOver(page) {
  return page.evaluate(() => {
    const points = [
      [window.innerWidth / 2, window.innerHeight / 2],
      [20, 20],
      [window.innerWidth - 20, window.innerHeight - 20],
    ];
    return points.some(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return (
        el?.tagName === "IFRAME" &&
        el.getAttribute("data-plugin-frame") === "hostile-frame" &&
        el.getAttribute("data-frame-role") === "background"
      );
    });
  });
}

/** Points outside the hostile view frame that show part of a foreign view. */
async function foreignOutside(page) {
  return page.evaluate(() => {
    const frame = document.querySelector(
      'iframe[data-plugin-frame="hostile-frame"]:not([data-frame-role="background"])',
    );
    const layer = document.querySelector(
      '[data-foreign-layer="hostile-frame"]',
    );
    if (!frame) return { error: "no view frame" };
    if (!layer || !layer.querySelector("[data-foreign-id]")) {
      return { error: "no foreign view drawn" };
    }
    const box = frame.getBoundingClientRect();
    const hits = [];
    const step = 40;
    for (let x = 2; x < window.innerWidth; x += step) {
      for (let y = 2; y < window.innerHeight; y += step) {
        const inside =
          x >= box.left - 1 &&
          x <= box.right + 1 &&
          y >= box.top - 1 &&
          y <= box.bottom + 1;
        if (inside) continue;
        const el = document.elementFromPoint(x, y);
        if (el && layer.contains(el)) hits.push([x, y]);
      }
    }
    return { hits: hits.slice(0, 10), count: hits.length };
  });
}

export async function runFrame(world, log) {
  const { chromium } = await import("playwright");
  await must(world.base, {
    method: "PUT",
    path: "/plugins/hostile-frame/settings/admin",
    identity: world.admin,
    body: { exfilOrigin: world.exfil.origin },
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  let popups = 0;
  let downloads = 0;
  context.on("page", () => popups++);
  const page = await context.newPage();
  await page.addInitScript(TOAST_COUNTER);
  await page.addInitScript(FRAME_TIMELINE);
  page.on("download", () => downloads++);
  const trouble = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      trouble.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      trouble.push(
        `${response.status()} ${response.request().method()} ${response.url().slice(0, 160)}`,
      );
    }
  });
  const appUrl = world.uiUrl ?? world.base;
  const leftUrl = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && !frame.url().startsWith(appUrl)) {
      leftUrl.push(frame.url());
    }
  });

  const results = {};
  try {
    await page.goto(appUrl);
    await page.locator("#login-user").first().waitFor({ timeout: 60_000 });
    await page.locator("#login-user").first().fill(world.adminName);
    await page.locator("#login-pass").fill(world.password);
    await page.keyboard.press("Enter");
    let setupError = null;
    await finishSetup(page).catch((error) => {
      setupError = error;
    });
    const pagesBefore = popups;

    // The background frame reports once it is done.
    let report = null;
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      const res = await call(world.base, {
        path: "/plugin-api/hostile-frame/report",
        identity: world.admin,
      });
      report = res.json?.background ?? null;
      if (report) break;
      await sleep(1000);
    }
    if (!report) throw new Error("the hostile frame never reported");
    Object.assign(results, report.results);
    await sleep(1500);
    const covered = await takenOver(page);
    results["page.overlay-takeover"] = {
      worked: covered,
      detail: covered
        ? "the background frame covers the shell"
        : "the shell stays on top",
    };
    if (setupError) {
      if (covered) {
        throw new Error(
          `the background frame covered the shell: ${setupError.message}`,
        );
      }
      throw setupError;
    }

    // The frame opens its own view, which drags a foreign view everywhere.
    await must(world.base, {
      method: "POST",
      path: "/plugin-api/hostile-frame/go",
      identity: world.admin,
    });
    const setupEnd = Date.now() + 30_000;
    while (Date.now() < setupEnd) {
      const res = await call(world.base, {
        path: "/plugin-api/hostile-frame/report",
        identity: world.admin,
      });
      if (res.json?.setup) {
        log?.(`frame setup: ${JSON.stringify(res.json.setup.results)}`);
        break;
      }
      await sleep(500);
    }
    // A tab opened without a click waits in the tab bar, so show it.
    await page
      .getByText("Hostile Frame", { exact: true })
      .filter({ visible: true })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => {});
    const opened = await page
      .locator(
        'iframe[data-plugin-frame="hostile-frame"]:not([data-frame-role="background"])',
      )
      .first()
      .waitFor({ state: "attached", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await sleep(4000);
    const overlay = opened
      ? await foreignOutside(page)
      : {
          error: `the view tab never opened (frames: ${await page.evaluate(() =>
            [...document.querySelectorAll("iframe")]
              .map(
                (f) =>
                  `${f.dataset.pluginFrame}/${f.dataset.frameRole ?? "view"}`,
              )
              .join(", "),
          )}; hostile frames: ${(
            await page.evaluate(() => window.__hostileFrames ?? [])
          ).join(", ")}; ${trouble.slice(-10).join(" | ")})`,
        };
    results["page.foreign-overlay"] = overlay.error
      ? { worked: false, error: true, detail: overlay.error }
      : {
          worked: overlay.count > 0,
          detail: `${overlay.count} points outside the frame show the foreign view ${JSON.stringify(overlay.hits)}`,
        };

    // Let the last toasts and popups land, and the frame leave.
    const navEnd = Date.now() + 40_000;
    while (!world.exfil.hits.get("selfnav") && Date.now() < navEnd) {
      await sleep(500);
    }
    await sleep(2000);
    const toasts = await page.evaluate(() => window.__hostileToasts ?? 0);
    results["page.toasts"] = {
      worked: toasts > 20,
      detail: `${toasts} toasts shown`,
    };
    results["page.popup"] = {
      worked: popups > pagesBefore,
      detail: `${popups - pagesBefore} new windows`,
    };
    results["page.download"] = {
      worked: downloads > 0,
      detail: `${downloads} downloads`,
    };
    results["page.top-nav"] = {
      worked: leftUrl.length > 0,
      detail: leftUrl.length ? `went to ${leftUrl[0]}` : "stayed",
    };
  } catch (error) {
    if (world.screenshotDir) {
      await page
        .screenshot({ path: `${world.screenshotDir}/hostile-failure.png` })
        .catch(() => {});
    }
    throw new Error(
      `${error.message} (page at ${page.url()})\n${trouble.slice(-25).join("\n")}`,
    );
  } finally {
    await browser.close().catch(() => {});
  }

  for (const [name, id] of Object.entries(LEAK_PATHS)) {
    const count = world.exfil.hits.get(name) ?? 0;
    results[id] = {
      worked: count > 0,
      detail: count
        ? `${count} requests reached the outside origin`
        : "none arrived",
    };
  }
  log?.("frame checks done");
  return results;
}
