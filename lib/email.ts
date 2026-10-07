import "server-only";

import { createTransport, type Transporter } from "nodemailer";

let transport: Transporter | null = null;

/** Sends a plain-text email through the SMTP server in SMTP_URL. */
export async function sendEmail(to: string, subject: string, text: string) {
  const url = process.env.SMTP_URL;
  if (!url) throw new Error("SMTP_URL must be set to send email");
  transport ??= createTransport(url);
  await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
}
