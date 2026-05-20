export function shouldTriggerSilentSignin(search: string) {
  const params = new URLSearchParams(search);
  for (const [key, rawValue] of params) {
    if (key.toLowerCase() !== "silentsignin") continue;
    const value = rawValue;
    return value === "" || value === "true" || value === "1";
  }
  return false;
}

export function removeSilentSigninFromSearch(search: string) {
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (key.toLowerCase() === "silentsignin") params.delete(key);
  }
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}
