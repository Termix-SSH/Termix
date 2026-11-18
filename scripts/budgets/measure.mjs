#!/usr/bin/env node
// Logs in to a running Termix and records what the page costs: frames after
// login, JS heap, core requests, time to dashboard and the backend's memory.
// The top level numbers are the warm load (a reload with caches full); the
// first load after login is under "cold".
//
//   node scripts/budgets/measure.mjs --url http://localhost:5173
//     [--api http://localhost:30001] [--user test] [--pass test123]
//     [--out result.json] [--settle 5000]

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { backendRssMb, countRequests, parseArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const url = String(args.url ?? "http://localhost:5173/");
const api = String(args.api ?? new URL(url).origin).replace(/\/+$/, "");
const user = String(args.user ?? "test");
const pass = String(args.pass ?? "test123");
const settleMs = Number(args.settle ?? 5000);
const warmupMs = Number(args.warmup ?? 20_000);
const maxWaitMs = Number(args["max-wait"] ?? 180_000);
let openPage = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resident memory of every process in a Docker container, in MB. Read from
 * /proc so it works on any image and any Termix version.
 */
function containerRssMb(name) {
  try {
    const out = execFileSync(
      "docker",
      [
        "exec",
        name,
        "sh",
        "-c",
        "cat /proc/[0-9]*/status 2>/dev/null | grep '^VmRSS:'",
      ],
      { encoding: "utf8" },
    );
    const kb = out
      .split("\n")
      .map((line) => Number(line.split(/\s+/)[1]))
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    return Math.round(kb / 1024);
  } catch {
    return null;
  }
}

async function frameCounts(page) {
  return page.evaluate(() => {
    const frames = [...document.querySelectorAll("iframe")];
    return {
      total: frames.length,
      background: frames.filter((f) => f.dataset.frameRole === "background")
        .length,
    };
  });
}

/**
 * Waits until the frame count holds still for settleMs. No frames at all
 * only counts after a while, since plugins load after the setup closes.
 */
async function waitForFrames(page, started) {
  let last = -1;
  let since = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const { total } = await frameCounts(page);
    if (total !== last) {
      last = total;
      since = Date.now();
    } else if (
      Date.now() - since >= settleMs &&
      (total > 0 || Date.now() - started >= 30_000)
    ) {
      return since - started;
    }
    await sleep(250);
  }
  return Date.now() - started;
}

/** Heap of the page's renderer plus every frame that runs in its own process. */
async function jsHeapMb(page) {
  let used = 0;
  const main = await page.context().newCDPSession(page);
  used += (await main.send("Runtime.getHeapUsage")).usedSize;
  await main.detach();
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let session;
    try {
      session = await page.context().newCDPSession(frame);
    } catch {
      continue; // same process as the page, already counted
    }
    try {
      used += (await session.send("Runtime.getHeapUsage")).usedSize;
    } catch {
      // frame went away
    }
    await session.detach().catch(() => {});
  }
  return Math.round(used / 1024 / 1024);
}

/**
 * Waits for the dashboard. A fresh server shows setup steps first (a whole
 * setup, then "a few new things" once plugins add steps); each gets its
 * button pressed until none shows for a few seconds.
 */
async function finishSetup(page) {
  const button = page.getByRole("button", {
    name: /^(Skip setup|Not now|Done)$/,
  });
  const stage = page.locator('[data-slot="tab-stage"]');
  const end = Date.now() + maxWaitMs;
  let pressed = false;
  let stageAt = 0;
  let quietSince = Date.now();
  while (Date.now() < end) {
    if (await button.count()) {
      pressed = true;
      await button
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      quietSince = Date.now();
      await sleep(500);
      continue;
    }
    if (await stage.count()) {
      if (!stageAt) stageAt = Date.now();
      if (Date.now() - quietSince > 3000) return { pressed, stageAt };
    }
    await sleep(250);
  }
  throw new Error("The dashboard did not load");
}

async function main() {
  const browser = await chromium.launch({
    args: ["--enable-precise-memory-info"],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  openPage = page;
  const requests = [];
  page.on("request", (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });

  // The server at rest, before a browser wakes any plugin.
  const idleRss = args.container
    ? containerRssMb(String(args.container))
    : null;

  await page.goto(url);
  const field = page.locator("#login-user");
  await field.first().waitFor({ timeout: 60_000 });
  await field.first().fill(user);
  await page.locator("#login-pass").fill(pass);
  requests.length = 0;
  let started = Date.now();
  await page.keyboard.press("Enter");
  let setup = await finishSetup(page);
  const onboarding = setup.pressed;
  if (onboarding) {
    // Plugins load on the first page load after the setup closes, so that
    // load is the cold one.
    requests.length = 0;
    started = Date.now();
    await page.reload();
    setup = await finishSetup(page);
  }
  const coldDashboardMs = setup.stageAt - started;
  const coldSettledMs = await waitForFrames(page, started);
  const cold = await frameCounts(page);
  const coldHeap = await jsHeapMb(page);
  const coldRequests = requests.length;

  // Give the first load time to store what plugins registered.
  await sleep(warmupMs);

  // Warm pass: the same browser loads the app again with its caches full,
  // which is what every visit after the first looks like.
  requests.length = 0;
  const reloaded = Date.now();
  await page.reload();
  const warm = await finishSetup(page);
  const timeToDashboardMs = warm.stageAt - reloaded;
  const settledMs = await waitForFrames(page, reloaded);
  const frames = await frameCounts(page);
  const heap = await jsHeapMb(page);

  let processes = null;
  try {
    const response = await page.request.get(`${api}/plugins/processes`);
    if (response.ok()) processes = await response.json();
  } catch {
    processes = null;
  }

  const container = args.container
    ? containerRssMb(String(args.container))
    : null;
  const routeRss = backendRssMb(processes);
  const result = {
    url,
    at: new Date().toISOString(),
    framesAfterLogin: frames.total,
    backgroundFrames: frames.background,
    jsHeapMb: heap,
    timeToDashboardMs,
    settledMs,
    // At rest (all plugins that may stop have stopped), from the container.
    backendRssMb: idleRss ?? routeRss ?? container,
    // Right after login, when the page has woken the plugins it shows.
    backendRssAfterLoginMb: routeRss ?? container,
    containerRssMb: container,
    pluginProcesses: processes
      ? (processes.plugins ?? []).filter((p) => p.state === "ready").length
      : null,
    requestCount: requests.length,
    cold: {
      onboarding,
      framesAfterLogin: cold.total,
      backgroundFrames: cold.background,
      jsHeapMb: coldHeap,
      timeToDashboardMs: coldDashboardMs,
      settledMs: coldSettledMs,
      requestCount: coldRequests,
    },
    topRequests: countRequests(requests).slice(0, 25),
  };
  await browser.close();
  const text = JSON.stringify(result, null, 2);
  if (args.out) writeFileSync(String(args.out), `${text}\n`);
  console.log(text);
}

main().catch(async (error) => {
  console.error(error);
  // What the page showed, so a failed run can be read without a rerun.
  if (openPage) {
    await openPage.screenshot({ path: "budget-failure.png" }).catch(() => {});
    const text = await openPage
      .evaluate(() => document.body?.innerText ?? "")
      .catch(() => "");
    console.error(`Page text: ${String(text).slice(0, 1500)}`);
  }
  process.exit(1);
});
