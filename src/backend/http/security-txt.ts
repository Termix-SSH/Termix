/**
 * RFC 9116 security.txt. It points to the Termix project, so reports about
 * Termix itself reach the maintainers from any install.
 */

import type { Request, Response } from "express";

const DAY = 24 * 60 * 60 * 1000;

/** The file body. Expires moves with the clock so it never goes stale. */
export function securityTxt(now = new Date()): string {
  const expires = new Date(now.getTime() + 180 * DAY);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    "Contact: https://github.com/Termix-SSH/Termix/security/advisories/new",
    `Expires: ${expires.toISOString()}`,
    "Acknowledgments: https://docs.termix.site/security#thanks",
    "Preferred-Languages: en",
    "Policy: https://docs.termix.site/security",
    "",
  ].join("\n");
}

/** GET /.well-known/security.txt, public by design. */
export function securityTxtHandler(_req: Request, res: Response): void {
  res
    .status(200)
    .type("text/plain; charset=utf-8")
    .set("Cache-Control", "public, max-age=86400")
    .send(securityTxt());
}
