const DEVICE_ID_STORAGE_KEY = "termixDeviceId";
const DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/;

function createDeviceId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function getDeviceId(): string | null {
  try {
    const stored = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;

    const deviceId = createDeviceId();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    return deviceId;
  } catch {
    return null;
  }
}
