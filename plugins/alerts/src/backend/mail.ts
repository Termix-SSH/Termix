import nodemailer from "nodemailer";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SendMail, SmtpSettings } from "./senders.js";

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The admin's SMTP server, or null while it is not set up. */
export async function readSmtp(
  ctx: PluginContext,
): Promise<SmtpSettings | null> {
  const all = await ctx.settings.getAll("admin");
  const host = str(all.smtpHost);
  const from = str(all.smtpFrom);
  if (!host || !from) return null;
  const port = Number(all.smtpPort);
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : 587,
    secure: all.smtpSecure === true,
    user: str(all.smtpUser),
    password: typeof all.smtpPassword === "string" ? all.smtpPassword : "",
    from,
  };
}

export const sendMail: SendMail = async (smtp, message) => {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({
      from: smtp.from,
      to: message.to.join(", "),
      subject: message.subject,
      text: message.text,
    });
  } finally {
    transport.close();
  }
};
