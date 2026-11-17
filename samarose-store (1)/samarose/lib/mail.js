import nodemailer from 'nodemailer';

let tx;
function transport() {
  if (tx !== undefined) return tx;
  const port = Number(process.env.SMTP_PORT) || 587;
  tx = process.env.SMTP_HOST
    ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined })
    : null;
  return tx;
}
/** Never throws: a mail problem must not break an order. */
export async function sendMail({ to, subject, text, replyTo }) {
  const t = transport();
  if (!t || !to) return console.log(`[mail not sent: SMTP not configured] ${subject}`);
  try { await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, replyTo }); }
  catch (e) { console.error('[mail failed]', e.message); }
}
