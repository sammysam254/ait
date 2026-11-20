import { getSupabaseAdmin } from '../database/supabaseClient';

export interface SendInviteParams {
  to: string;
  fullName?: string;
  inviterName?: string;
  orgName?: string;
  inviteToken: string;
  inviteUrl: string;
}

export class EmailService {
  /**
   * Dispatches an invitation email to a prospective subordinate worker.
   * Attempts Supabase Auth Admin invite first, then custom webhook if configured,
   * while always generating and returning the direct link for dashboard copying.
   */
  static async sendInviteEmail(params: SendInviteParams): Promise<{ sent: boolean; method: string; error?: string }> {
    const { to, fullName, inviterName, orgName, inviteUrl } = params;

    console.log(`[EmailService] =================================================`);
    console.log(`[EmailService] 📧 OUTGOING TEAM INVITATION EMAIL`);
    console.log(`[EmailService] To           : ${to}`);
    console.log(`[EmailService] Inviter      : ${inviterName || 'Account Owner'}`);
    console.log(`[EmailService] Organization : ${orgName || 'Vertex Cloud Device Farm'}`);
    console.log(`[EmailService] Invite Link  : ${inviteUrl}`);
    console.log(`[EmailService] =================================================`);

    // 1. Attempt Supabase Auth Admin Invitation
    const supabaseAdmin = getSupabaseAdmin();
    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(to, {
          redirectTo: inviteUrl,
          data: {
            full_name: fullName || to.split('@')[0],
            system_role: 'assigned_user',
          },
        });

        if (!error && data?.user) {
          console.log(`[EmailService] ✅ Supabase Auth invite successfully dispatched to ${to}`);
          return { sent: true, method: 'supabase' };
        } else if (error) {
          console.warn(`[EmailService] ℹ️ Supabase Auth notice: ${error.message} (Using direct registration link)`);
        }
      } catch (err: any) {
        console.warn(`[EmailService] ℹ️ Supabase Auth invite unavailable: ${err?.message || err}`);
      }
    }

    // 2. Custom Webhook / API Dispatcher (if configured in environment)
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const html = this.renderInviteHtml(params);
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            subject: `Invitation to join ${orgName || 'Vertex Cloud Device Farm'}`,
            html,
            inviteUrl,
          }),
        });
        console.log(`[EmailService] ✅ Custom email webhook dispatched successfully to ${to}`);
        return { sent: true, method: 'webhook' };
      } catch (webhookErr: any) {
        console.warn(`[EmailService] Webhook email failed: ${webhookErr?.message}`);
      }
    }

    // Direct link ready for dashboard copy & manual email sending
    return { sent: false, method: 'direct_link' };
  }

  /**
   * Generates a modern, clean HTML email template for invitations
   */
  static renderInviteHtml(params: SendInviteParams): string {
    const { to, inviterName, orgName, inviteUrl } = params;
    const inviter = inviterName || 'Your team administrator';
    const organization = orgName || 'Vertex Cloud Device Farm';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation - Vertex SaaS</title>
</head>
<body style="margin: 0; padding: 0; background-color: #030712; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #030712; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background-color: #111827; border: 1px solid #1f2937; border-radius: 20px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">VERTEX SAAS</h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #e0e7ff; font-weight: 500;">Cloud Device Management Platform</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #ffffff;">You're Invited to Join the Team</h2>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #9ca3af;">
                <strong style="color: #ffffff;">${inviter}</strong> has invited you (<span style="color: #818cf8;">${to}</span>) to collaborate on <strong style="color: #ffffff;">${organization}</strong>.
              </p>
              <p style="margin: 0 0 28px; font-size: 14px; line-height: 1.6; color: #9ca3af;">
                Once you set up your account password, you will receive immediate access to the Android devices assigned to you. You can view high-definition live streams, perform remote touch controls, and generate share links & PINs.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 10px 0 30px;">
                    <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.4);">
                      Accept Invitation & Set Password →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback URL Box -->
              <div style="background-color: #030712; border: 1px solid #1f2937; border-radius: 12px; padding: 16px;">
                <p style="margin: 0 0 8px; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Direct Registration URL</p>
                <p style="margin: 0; font-size: 12px; word-break: break-all; color: #93c5fd; font-family: monospace;">
                  <a href="${inviteUrl}" style="color: #93c5fd; text-decoration: none;">${inviteUrl}</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #0b0f19; border-top: 1px solid #1f2937; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #6b7280;">
                This invitation link was issued specifically for ${to}. If you were not expecting this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }
}
