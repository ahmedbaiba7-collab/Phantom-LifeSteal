import nodemailer from 'nodemailer';
import { env, isProd } from '../config/env';
import { logger } from './logger';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  pool: true,
  maxConnections: 5,
});

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:32px 16px;background:#07060B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#0F0B1B;border:1px solid rgba(168,85,247,.22);border-radius:16px;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;border-bottom:1px solid rgba(168,85,247,.14);">
        <span style="font-size:13px;letter-spacing:.24em;text-transform:uppercase;color:#A855F7;font-weight:700;">LifeSteal Phantom</span>
      </td></tr>
      <tr><td style="padding:28px 32px;color:#EDE9FE;font-size:15px;line-height:1.65;">
        <h1 style="margin:0 0 16px;font-size:22px;color:#fff;font-weight:700;">${title}</h1>
        ${bodyHtml}
        ${
          cta
            ? `<div style="margin:28px 0 8px;"><a href="${cta.url}" style="display:inline-block;padding:13px 26px;border-radius:10px;background:#A855F7;color:#0B0713;font-weight:700;text-decoration:none;font-size:15px;">${cta.label}</a></div>
               <p style="margin:14px 0 0;font-size:12px;color:#7C7594;word-break:break-all;">If the button does not work, paste this into your browser:<br>${cta.url}</p>`
            : ''
        }
      </td></tr>
      <tr><td style="padding:18px 32px 26px;border-top:1px solid rgba(168,85,247,.14);color:#7C7594;font-size:12px;line-height:1.6;">
        You are receiving this because an account on ${env.WEB_ORIGIN} used this address.
        If that was not you, no action is needed and nothing has changed.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html });
    logger.info({ to: to.replace(/(.{2}).*(@.*)/, '$1***$2'), subject }, 'mail sent');
  } catch (err) {
    // Mail failure never breaks the request that triggered it — the user gets a
    // "check your inbox" response and can request a resend.
    logger.error({ err, subject }, 'mail delivery failed');
    if (!isProd) throw err;
  }
}

export const mailer = {
  verifyEmail(to: string, username: string, token: string) {
    const url = `${env.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
    return send(
      to,
      'Confirm your email',
      layout(
        'Confirm your email',
        `<p>Welcome, <strong>${username}</strong>. Confirm this address to activate your account and start claiming vote rewards.</p>
         <p style="color:#948CAD;">This link expires in 24 hours.</p>`,
        { label: 'Confirm email', url },
      ),
    );
  },

  passwordReset(to: string, username: string, token: string) {
    const url = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    return send(
      to,
      'Reset your password',
      layout(
        'Reset your password',
        `<p>Hi <strong>${username}</strong>, use the button below to set a new password.</p>
         <p style="color:#948CAD;">This link expires in 1 hour and works once. Your current password stays active until you finish.</p>`,
        { label: 'Set a new password', url },
      ),
    );
  },

  newDevice(to: string, username: string, ip: string, device: string, when: Date) {
    return send(
      to,
      'New sign-in to your account',
      layout(
        'New sign-in detected',
        `<p>Hi <strong>${username}</strong>, your account was accessed from a device we have not seen before.</p>
         <table style="margin:18px 0;font-size:14px;color:#EDE9FE;">
           <tr><td style="padding:4px 16px 4px 0;color:#948CAD;">When</td><td>${when.toUTCString()}</td></tr>
           <tr><td style="padding:4px 16px 4px 0;color:#948CAD;">IP</td><td>${ip}</td></tr>
           <tr><td style="padding:4px 16px 4px 0;color:#948CAD;">Device</td><td>${device}</td></tr>
         </table>
         <p>If this was you, ignore this message. If not, change your password and sign out every device from your security settings.</p>`,
        { label: 'Review active sessions', url: `${env.WEB_ORIGIN}/dashboard/security` },
      ),
    );
  },

  orderReceipt(to: string, username: string, reference: string, total: string) {
    return send(
      to,
      `Order ${reference} confirmed`,
      layout(
        'Order confirmed',
        `<p>Thanks, <strong>${username}</strong>. Order <strong>${reference}</strong> for <strong>${total}</strong> is paid.</p>
         <p>Your items are being delivered in game now. If the server is restarting, delivery completes automatically the next time you join.</p>`,
        { label: 'View invoice', url: `${env.WEB_ORIGIN}/dashboard/orders` },
      ),
    );
  },

  ticketReply(to: string, username: string, reference: string) {
    return send(
      to,
      `Staff replied to ${reference}`,
      layout(
        'Staff replied to your ticket',
        `<p>Hi <strong>${username}</strong>, there is a new reply on ticket <strong>${reference}</strong>.</p>`,
        { label: 'Open ticket', url: `${env.WEB_ORIGIN}/support/${reference}` },
      ),
    );
  },
};
