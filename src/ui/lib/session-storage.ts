export function clearTermixSessionStorage(): void {
  localStorage.removeItem("termix_tabs");
  localStorage.removeItem("termix_currentTab");
}
