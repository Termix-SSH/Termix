const DONATION_MODAL_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

export function shouldShowDonationModal(
  registeredAt: string,
  donationModalDismissed: boolean,
  now: number = Date.now(),
): boolean {
  if (donationModalDismissed) return false;
  const registeredAtMs = Date.parse(registeredAt);
  if (Number.isNaN(registeredAtMs)) return false;
  return now - registeredAtMs >= DONATION_MODAL_DELAY_MS;
}
