import { config } from '../config.js';

/**
 * Post a message to Slack.
 *
 * Slack answers 200 even when it refuses the call, putting the reason in
 * `ok: false` + `error` — so the status code alone never tells you whether the
 * message was delivered.
 */
export async function postSlackMessage(
  channel: string,
  text: string,
): Promise<{ ts: string }> {
  if (!config.slack.token) {
    throw new Error('Chưa cấu hình SLACK_USER_TOKEN trong backend/.env.');
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.slack.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    // `as_user` is what makes a user token post as the person rather than as
    // the app. It is ignored by a bot token, so the same call covers both.
    body: JSON.stringify({ channel, text, as_user: true }),
  });

  const body = (await response.json().catch(() => undefined)) as
    | { ok?: boolean; error?: string; ts?: string }
    | undefined;

  if (!response.ok) {
    throw new Error(`Slack trả về HTTP ${response.status}.`);
  }
  if (!body?.ok) {
    throw new Error(describeSlackError(body?.error));
  }
  return { ts: String(body.ts ?? '') };
}

/**
 * The three failures that actually happen during setup, in Vietnamese —
 * Slack's raw codes say nothing about what to do next.
 */
function describeSlackError(code: string | undefined): string {
  switch (code) {
    case 'not_in_channel':
      return 'Tài khoản gửi chưa ở trong kênh. Tự join kênh đó trên Slack rồi thử lại.';
    case 'channel_not_found':
      return 'Không tìm thấy kênh. Kiểm tra lại SLACK_REPORT_CHANNEL (phải là channel ID dạng C...).';
    case 'invalid_auth':
    case 'not_authed':
    case 'token_revoked':
      return 'Token Slack không hợp lệ hoặc đã bị thu hồi. Lấy lại Bot User OAuth Token (xoxb-...).';
    case 'missing_scope':
      return 'Slack app thiếu scope chat:write. Thêm scope rồi cài lại app vào workspace.';
    default:
      return `Slack từ chối: ${code ?? 'không rõ lỗi'}.`;
  }
}
