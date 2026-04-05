import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || '');
const FROM_EMAIL = 'ScriptFlare <noreply@scriptflare.app>';

export interface AutopilotSummaryEmail {
  to: string;
  scripts: Array<{ topic: string; notionUrl?: string }>;
  date: string;
}

/**
 * Send autopilot daily summary email
 */
export async function sendAutopilotSummary(params: AutopilotSummaryEmail): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY not set, skipping email');
    return;
  }

  const scriptList = params.scripts
    .map((s, i) => {
      const link = s.notionUrl ? `<a href="${s.notionUrl}">${s.topic}</a>` : s.topic;
      return `<li>${i + 1}. ${link}</li>`;
    })
    .join('\n');

  await resend.emails.send({
    from: FROM_EMAIL,
    to: params.to,
    subject: `✅ Your ScriptFlare Autopilot scripts for ${params.date} are ready`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff6b35;">🔥 ScriptFlare Autopilot</h2>
        <p>Your AI-generated scripts for <strong>${params.date}</strong> are ready in Notion:</p>
        <ul style="line-height: 2;">
          ${scriptList}
        </ul>
        <p style="color: #666; font-size: 14px;">
          These scripts were automatically generated based on trending YouTube topics in your niche.<br>
          <a href="https://mingkai1207.github.io/scriptflare/account.html">Manage your Autopilot settings →</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #999; font-size: 12px;">
          You're receiving this because you have ScriptFlare Autopilot enabled.<br>
          <a href="https://mingkai1207.github.io/scriptflare/account.html">Unsubscribe or change settings</a>
        </p>
      </div>
    `,
  });
}

/**
 * Send welcome email after signup
 */
export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: '🎬 Welcome to ScriptFlare!',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff6b35;">Welcome to ScriptFlare, ${name || 'Creator'}! 🎉</h2>
        <p>You're all set to start creating faceless YouTube scripts that actually get watched.</p>
        <p>
          <a href="https://mingkai1207.github.io/scriptflare/"
             style="background: #ff6b35; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Start Creating Scripts →
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          With your free account you get 3 scripts. Upgrade to Pro ($19/mo) for unlimited scripts,
          or Autopilot ($49/mo) to have scripts auto-generated and delivered to Notion every day.
        </p>
      </div>
    `,
  });
}
