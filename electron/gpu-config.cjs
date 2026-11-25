// Startup GPU policy and crash-driven software-rendering fallback.

const GPU_CRASH_FALLBACK_THRESHOLD = 3;

function shouldDisableHardwareAcceleration({
  env = process.env,
  settings = {},
} = {}) {
  if (env && env.ELECTRON_DISABLE_GPU === "1") {
    return true;
  }
  if (settings && settings.disableHardwareAcceleration === true) {
    return true;
  }
  return false;
}

function createGpuCrashTracker({
  threshold = GPU_CRASH_FALLBACK_THRESHOLD,
  onThresholdReached,
  log,
} = {}) {
  let crashCount = 0;
  let fallbackTriggered = false;

  function handleChildProcessGone(details) {
    if (!details || details.type !== "GPU") {
      return false;
    }
    if (details.reason === "clean-exit") {
      return false;
    }

    crashCount += 1;
    if (typeof log === "function") {
      log(
        `[gpu] GPU child process gone (reason=${details.reason}, exitCode=${details.exitCode}, count=${crashCount}/${threshold}).`,
      );
    }

    if (!fallbackTriggered && crashCount >= threshold) {
      fallbackTriggered = true;
      if (typeof onThresholdReached === "function") {
        onThresholdReached(details, crashCount);
      }
      return true;
    }

    return false;
  }

  return {
    handleChildProcessGone,
    getCrashCount: () => crashCount,
  };
}

module.exports = {
  GPU_CRASH_FALLBACK_THRESHOLD,
  shouldDisableHardwareAcceleration,
  createGpuCrashTracker,
};
