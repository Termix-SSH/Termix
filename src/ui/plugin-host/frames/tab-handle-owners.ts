/**
 * Which plugin a framed tab's handle came from. Core keeps the full handle;
 * another plugin's frame only gets the calls it is allowed to make.
 */

const owners = new WeakMap<object, string>();

export function setTabHandleOwner(handle: object, pluginId: string): void {
  owners.set(handle, pluginId);
}

export function tabHandleOwner(handle: object): string | undefined {
  return owners.get(handle);
}
