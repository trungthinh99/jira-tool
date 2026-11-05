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

/**
 * The three reactions, picked at random per message.
 *
 * Jame's messages are themselves automated, so answering every one with the
 * same emoji would read as another bot. Varying it keeps the thread looking
 * like a person skimmed it, which is what it is.
 */
const REACTIONS = ['+1', 'eyes', 'raised_hands'];

/** One message found worth reacting to. */
interface Candidate {
  channel: string;
  ts: string;
  text: string;
}

export interface ReactResult {
  /** Messages a reaction was added to. */
  reacted: number;
  /** Matching messages that already carried one of ours. */
  skipped: number;
  /** Channels that could not be read, with why. */
  errors: string[];
}

/**
 * Jame's auto-posted "sub-task created" message.
 *
 * **The wording differs per channel**, which is why this matches loosely.
 * Measured on live messages:
 *
 *   hwashin-erp: `<@U...> em đã tạo sub-task cho anh trong <link> rồi nha`
 *   dob-tms:     `<@U...> em tạo xong sub-task của <link> cho anh rồi nha`
 *
 * Matching the first phrasing alone found 5 messages on HWE and **none** on
 * DT. So the test is the two parts both forms share — the words `sub-task` and
 * the `rồi nha` sign-off — rather than the sentence in between, which is also
 * where the Jira link sits and so varies with every story.
 *
 * The message must also mention *me*. Jame posts the same sentence to other
 * people — `<@U0AJ9AF01A5> anh có tạo sub-task của ...` appears 9 times in 30
 * days on dob-tms — and reacting to those would be answering somebody else's
 * hand-off. Filtering on the sentence alone matched 109 of his 126 messages;
 * requiring the mention is what narrows it to the ones addressed to me.
 */
const SUBTASK_LINE = /sub-?task[\s\S]*rồi nha/i;

/**
 * Add a reaction to each of Jame's recent sub-task messages.
 *
 * Only looks back over `sinceDays`, because the point is to answer what he
 * posted today — and, on a Monday, what he posted while the week was off.
 * There is no forward window: a message cannot arrive from tomorrow.
 *
 * Already-reacted messages are skipped rather than retried. Slack rejects a
 * duplicate with `already_reacted`, so this is mostly about not spending a
 * request per message per press — but it also means pressing the button twice
 * in a row is harmless, which is the behaviour to rely on.
 */
export async function reactToSubtaskMessages(sinceDays = 2): Promise<ReactResult> {
  if (!config.slack.token) {
    throw new Error('Chưa cấu hình SLACK_USER_TOKEN trong backend/.env.');
  }

  const me = await slackGet<{ user_id?: string }>('auth.test', {});
  const oldest = Math.floor(Date.now() / 1000) - sinceDays * 24 * 60 * 60;

  const result: ReactResult = { reacted: 0, skipped: 0, errors: [] };

  for (const channel of config.slack.reactChannels) {
    let found: Candidate[];
    try {
      found = await readSubtaskMessages(channel, oldest, me.user_id);
    } catch (caught) {
      // One unreadable channel must not lose the other: a missing invite or a
      // renamed channel is a per-channel fact.
      result.errors.push(
        `${channel}: ${caught instanceof Error ? caught.message : 'lỗi không rõ'}`,
      );
      continue;
    }

    for (const message of found) {
      try {
        if (await alreadyReacted(message, me.user_id)) {
          result.skipped += 1;
          continue;
        }
        const name = REACTIONS[Math.floor(Math.random() * REACTIONS.length)] ?? REACTIONS[0]!;
        await slackPost('reactions.add', {
          channel: message.channel,
          timestamp: message.ts,
          name,
        });
        result.reacted += 1;
      } catch (caught) {
        const why = caught instanceof Error ? caught.message : 'lỗi không rõ';
        // `already_reacted` is a race, not a failure: someone (or a previous
        // press) got there between the read and the write.
        if (why.includes('already_reacted')) result.skipped += 1;
        else result.errors.push(`${message.channel} ${message.ts}: ${why}`);
      }
    }
  }

  return result;
}

/** Jame's sub-task messages addressed to me in one channel, newer than `oldest`. */
async function readSubtaskMessages(
  channel: string,
  oldest: number,
  meId: string | undefined,
): Promise<Candidate[]> {
  const body = await slackGet<{
    messages?: { user?: string; text?: string; ts?: string; subtype?: string }[];
  }>('conversations.history', { channel, oldest: String(oldest), limit: '200' });

  return (body.messages ?? [])
    .filter((message) => {
      if (message.user !== config.slack.reactUser || message.subtype) return false;
      const text = message.text ?? '';
      if (!SUBTASK_LINE.test(text)) return false;
      // Addressed to me, not to whoever else Jame hands work to.
      return meId ? text.includes(`<@${meId}>`) : true;
    })
    .map((message) => ({ channel, ts: String(message.ts), text: message.text ?? '' }));
}

/**
 * Whether this message already carries one of my reactions.
 *
 * Checks for *mine* specifically, not for any reaction: Jame's messages often
 * pick up a 👀 from someone else, and treating that as done would leave his
 * message unanswered by me.
 */
async function alreadyReacted(message: Candidate, meId: string | undefined): Promise<boolean> {
  const body = await slackGet<{
    message?: { reactions?: { name?: string; users?: string[] }[] };
  }>('reactions.get', { channel: message.channel, timestamp: message.ts });

  const reactions = body.message?.reactions ?? [];
  if (!meId) return reactions.length > 0;
  return reactions.some((reaction) => (reaction.users ?? []).includes(meId));
}

async function slackGet<T>(method: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(
    `https://slack.com/api/${method}?${new URLSearchParams(params)}`,
    { headers: { Authorization: `Bearer ${config.slack.token}` } },
  );
  return readSlackBody<T>(response);
}

async function slackPost<T>(method: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.slack.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  });
  return readSlackBody<T>(response);
}

/** Slack answers 200 on refusal, so `ok` is the only real status. See above. */
async function readSlackBody<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | ({ ok?: boolean; error?: string; needed?: string } & T)
    | undefined;

  if (!response.ok) throw new Error(`Slack trả về HTTP ${response.status}.`);
  if (!body?.ok) {
    const code = body?.error;
    // The scope error is the one that will actually be hit here, so it says
    // which scopes are missing rather than just naming the failure.
    if (code === 'missing_scope') {
      throw new Error(
        `Slack app thiếu scope${body?.needed ? ` (cần: ${body.needed})` : ''}. ` +
          'Thêm vào User Token Scopes rồi Reinstall app.',
      );
    }
    throw new Error(describeSlackError(code));
  }
  return body;
}
