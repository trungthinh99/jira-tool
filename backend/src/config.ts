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

export const REPORT_TARGETS: ReportTarget[] = [
  {
    id: 'hwashin',
    label: 'Hwashin ERP',
    projectKey: 'HWE',
    reportIssueKey: 'PPP-354',
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
    reportIssueKey: 'PPP-308',
    mentions: [SUMI, RUBY],
    defaultNextTasks: ['Fix bug theo feedback (nếu có)', 'Sửa giao diện theo thiết kế mới'],
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
  jira: {
    /** Host only, no scheme — the client builds the URL. */
    site: process.env.JIRA_SITE ?? 'jakenm.atlassian.net',
    email: required('JIRA_EMAIL'),
    token: required('JIRA_API_TOKEN'),
  },
  /** Dev origins allowed to call this proxy. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5180')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

export function findTarget(id: string): ReportTarget | undefined {
  return REPORT_TARGETS.find((t) => t.id === id);
}
