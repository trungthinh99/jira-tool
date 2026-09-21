import type { Mention } from '../config.js';

export interface TodayTaskLine {
  /** Issue key, e.g. `HWE-425`. */
  key: string;
  /** Progress as shown after the colon, e.g. `100`. */
  percent: number;
}

export interface ReportInput {
  /** Report date, already formatted `DD/MM/YYYY` by the caller. */
  dateLabel: string;
  todayTasks: TodayTaskLine[];
  nextTasks: string[];
  issue: string;
  mentions: Mention[];
  site: string;
}

type Node = Record<string, unknown>;

function strong(text: string): Node {
  return { type: 'text', text, marks: [{ type: 'strong' }] };
}

function plain(text: string): Node {
  return { type: 'text', text };
}

function hardBreak(): Node {
  return { type: 'hardBreak' };
}

/** A bullet whose content is a single paragraph. */
function bullet(content: Node[]): Node {
  return { type: 'listItem', content: [{ type: 'paragraph', content }] };
}

/**
 * An issue link rendered the way the existing reports render it: the URL as the
 * visible text, carrying a `link` mark. Jira turns a bare text URL into a link
 * on render but stores it unmarked, and the report history shows marked links —
 * so the mark is written explicitly rather than left to the renderer.
 */
function issueLink(site: string, key: string): Node {
  const href = `https://${site}/browse/${key}`;
  return { type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] };
}

/**
 * Build the daily report comment.
 *
 * Shape is copied from the reports already on PPP-308 / PPP-354:
 *
 *     *Report 18/09/2026
 *     Today task:
 *      • https://.../browse/HWE-425: 100%
 *     Next task:
 *      • Ghép API theo điều chỉnh từ BA và BE
 *     Issue: none
 *     @Ruby @sney
 *
 * The leading `*` on `*Report` is unbalanced on purpose — that is what the
 * house template does, and matching it keeps the history uniform.
 */
export function buildReportAdf(input: ReportInput): Node {
  const content: Node[] = [];

  content.push({
    type: 'paragraph',
    content: [
      strong(`*Report ${input.dateLabel} `),
      plain(' '),
      hardBreak(),
      strong('Today task:'),
    ],
  });

  content.push({
    type: 'bulletList',
    content: input.todayTasks.map((task) =>
      bullet([issueLink(input.site, task.key), plain(`: ${task.percent}%`)]),
    ),
  });

  content.push({ type: 'paragraph', content: [strong('Next task:')] });

  content.push({
    type: 'bulletList',
    content: input.nextTasks.map((line) => bullet([plain(line)])),
  });

  const tail: Node[] = [strong('Issue: '), plain(input.issue), hardBreak()];
  for (const mention of input.mentions) {
    tail.push({
      type: 'mention',
      attrs: { id: mention.accountId, text: `@${mention.name}` },
    });
    tail.push(plain(' '));
  }
  content.push({ type: 'paragraph', content: tail });

  return { type: 'doc', version: 1, content };
}

/**
 * Render the same report as plain text, for the UI preview.
 *
 * Kept beside the ADF builder so the two cannot describe different reports;
 * the preview is what the user approves before posting.
 */
export function renderReportText(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`*Report ${input.dateLabel}`);
  lines.push('Today task:');
  for (const task of input.todayTasks) {
    lines.push(`  • https://${input.site}/browse/${task.key}: ${task.percent}%`);
  }
  lines.push('Next task:');
  for (const next of input.nextTasks) {
    lines.push(`  • ${next}`);
  }
  lines.push(`Issue: ${input.issue}`);
  lines.push(input.mentions.map((m) => `@${m.name}`).join(' '));
  return lines.join('\n');
}
