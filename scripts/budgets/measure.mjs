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

/** Waits until the frame count holds still for settleMs. */
async function waitForFrames(page, started) {
  let last = -1;
  let since = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const { total } = await frameCounts(page);
    if (total !== last) {
      last = total;
      since = Date.now();
    } else if (Date.now() - since >= settleMs) {
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

  await page.goto(url);
  const field = page.locator("#login-user");
  await field.first().waitFor({ timeout: 60_000 });
  await field.first().fill(user);
  await page.locator("#login-pass").fill(pass);
  requests.length = 0;
  const started = Date.now();
  await page.keyboard.press("Enter");
  // A fresh server shows its setup first; skip it so the dashboard loads.
  const skip = page.getByRole("button", { name: /^(Skip setup|Not now)$/ });
  const stage = page.locator('[data-slot="tab-stage"]').first();
  await Promise.race([
    skip.first().waitFor({ timeout: maxWaitMs }),
    stage.waitFor({ state: "attached", timeout: maxWaitMs }),
  ]);
  let coldDashboardMs = Date.now() - started;
  let onboarding = false;
  // The setup can show a moment after the shell itself.
  for (let i = 0; i < 20 && !onboarding; i++) {
    if (await skip.count()) {
      onboarding = true;
      await skip.first().click();
    } else {
      await sleep(250);
    }
  }
  await stage.waitFor({ state: "attached", timeout: maxWaitMs });
  if (onboarding) coldDashboardMs = Date.now() - started;
  const coldSettledMs = await waitForFrames(page, started);
  const cold = await frameCounts(page);
  const coldHeap = await jsHeapMb(page);
  const coldRequests = requests.length;

  // Warm pass: the same browser loads the app again with its caches full,
  // which is what every visit after the first looks like.
  requests.length = 0;
  const reloaded = Date.now();
  await page.reload();
  await page
    .locator('[data-slot="tab-stage"]')
    .first()
    .waitFor({ state: "attached", timeout: maxWaitMs });
  const timeToDashboardMs = Date.now() - reloaded;
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
    // The processes route when the server has it, else the container's sum.
    backendRssMb: routeRss ?? container,
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
