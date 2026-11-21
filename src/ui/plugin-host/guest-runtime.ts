/**
 * Whether the plugin runtime serves an anonymous page, like a shared session
 * link. Frames there get no token, so they reach only public routes.
 */
let guest = false;

export function setGuestRuntime(value: boolean): void {
  guest = value;
}

export function isGuestRuntime(): boolean {
  return guest;
}
