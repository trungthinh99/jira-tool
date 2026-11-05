import 'dotenv/config';

/**
 * Report targets. Each tracked Jira project posts its daily report as a comment
 * on its own PPP issue, and mentions its own people — the two are not
 * interchangeable, which is why they are declared together rather than as two
 * parallel lookup tables that could drift apart.
 */
export interface ReportTarget {
  /** Stable id used by the UI as a tab key. */
  id: string;
  /** Tab label. */
  label: string;
  /** Jira project key whose issues feed this report. */
  projectKey: string;
  /** Issue the daily report comment is posted to. */
  reportIssueKey: string;
  /** Accounts mentioned at the end of the report, in order. */
  mentions: Mention[];
  /** Seeded into the "Next task" box when no previous report can be parsed. */
  defaultNextTasks: string[];
}

export interface Mention {
  accountId: string;
  /** Display name, rendered as `@name` in the ADF mention node. */
  name: string;
}

const RUBY: Mention = {
  accountId: '712020:cc414e81-af9e-4033-8159-e7ed19785489',
  name: 'Ruby',
};
const SNEY: Mention = {
  accountId: '712020:d22b3123-52e3-46cb-b435-4b9a30fb166f',
  name: 'sney',
};
const SUMI: Mention = {
  accountId: '70121:5b5e92a5-862c-4edc-994f-c02ab8a3280f',
  name: 'Sumi',
};
const MINJUN: Mention = {
  accountId: '712020:9f629ab7-904b-49b4-95a8-a2aed75661a6',
  name: 'Minjun',
};
const LUCA: Mention = {
  accountId: '712020:7aa99717-ae01-4697-9022-1277d79bfa9c',
  name: 'Luca',
};

export const REPORT_TARGETS: ReportTarget[] = [
  {
    id: 'hwashin',
    label: 'Hwashin ERP',
    projectKey: 'HWE',
    reportIssueKey: 'PPP-341',
    mentions: [RUBY, SNEY],
    defaultNextTasks: [
      'Ghép API theo điều chỉnh từ BA và BE',
      'Fix bug (nếu có)',
      'Chỉnh sửa lại giao diện theo feedback',
    ],
  },
  {
    id: 'tms',
    label: 'TMS',
    projectKey: 'DT',
    reportIssueKey: 'PPP-226',
    // Luca replaced Sumi here on 19/10/2026, at Bimo's request. Sumi is still
    // mentioned on SportsRab — the change is TMS only.
    mentions: [LUCA, RUBY],
    defaultNextTasks: ['Fix bug theo feedback (nếu có)', 'Sửa giao diện theo thiết kế mới'],
  },
  {
    id: 'sportsrab',
    label: 'SportsRab',
    projectKey: 'SR',
    reportIssueKey: 'PPP-349',
    // Ruby first, Sumi second. Taken from the real comment history on PPP-351,
    // not guessed from the other targets. Minjun was added by Bimo on
    // 23/09/2026 and is not in that history.
    mentions: [RUBY, SUMI, MINJUN],
    defaultNextTasks: ['Ghép API theo thiết kế mới', 'Fix bug theo feedback (nếu có)'],
  },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy backend/.env.example to backend/.env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4180),
  /**
   * Loopback only, deliberately not configurable. The API has no login and
   * every write lands on Jira and Slack under Bimo's name; listening on all
   * interfaces let anyone on the office LAN call it. CORS does not help —
   * it only restrains browsers, not curl.
   */
  host: '127.0.0.1',
  jira: {
    /** Host only, no scheme — the client builds the URL. */
    site: process.env.JIRA_SITE ?? 'jakenm.atlassian.net',
    email: required('JIRA_EMAIL'),
    token: required('JIRA_API_TOKEN'),
  },
  /**
   * Optional. Without a token the tool behaves exactly as before: the report
   * goes to Jira and nothing is sent to Slack. Slack is a courtesy ping, not
   * part of the record.
   */
  slack: {
    /**
     * User token (`xoxp-...`) wins over the bot token: the message should read
     * as Bimo reporting, not as an app. A bot token still works as a fallback,
     * but the message then carries Slack's APP tag.
     */
    token: process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN || '',
    channel: process.env.SLACK_REPORT_CHANNEL ?? '',
    message: process.env.SLACK_REPORT_MESSAGE ?? 'em báo cáo rồi nha chị',
    /**
     * Channels scanned for Jame's "em đã tạo sub-task" messages, and his user
     * id. Configurable because they are workspace facts, not code — a new
     * project means a new channel here, not an edit to the scanner.
     */
    reactChannels: (process.env.SLACK_REACT_CHANNELS ?? 'C0ATW99QH9B,C0BJQ7QFPPT')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    reactUser: process.env.SLACK_REACT_USER ?? 'U0A2PE5Q0LB',
  },
  /** Dev origins allowed to call this proxy. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5180')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

/** Slack only fires when both the token and a destination channel are set. */
export function slackEnabled(): boolean {
  return Boolean(config.slack.token && config.slack.channel);
}

export function findTarget(id: string): ReportTarget | undefined {
  return REPORT_TARGETS.find((t) => t.id === id);
}
