import { config } from '../config.js';

/**
 * Ask Jira's own AI to break an issue down, and keep the QA line.
 *
 * This is the engine behind the "Suggest" button in the Subtasks section of the
 * Jira issue view. Atlassian publishes no API for it: there is nothing in REST
 * v3, nothing in the Rovo MCP tool list, and their own request for one (AI-8,
 * opened Dec 2023, 136 votes) is still "Gathering Interest". The endpoint below
 * was read off the browser's own network traffic on 16/10/2026.
 *
 * It is therefore **internal and undocumented**, and may change or vanish
 * without notice. Every caller must treat a failure as normal and carry on with
 * the house default title — see `suggestQaTitle` returning null.
 *
 * The one piece of luck: it accepts the same Basic auth as the documented API,
 * so no browser session, cookie or scraping is involved. The two headers are
 * required; without `X-Experience-Id` it answers `400 BAD_REQUEST`.
 */
const WORK_BREAKDOWN =
  '/gateway/api/assist/api/ai/v2/ai-feature/jira/workbreakdown';

const authHeader = `Basic ${Buffer.from(
  `${config.jira.email}:${config.jira.token}`,
).toString('base64')}`;

/** One line of the suggestion, as the AI returns it. */
interface ChildIssue {
  summary?: string;
  description?: string;
  issueType?: string;
}

/**
 * How long to wait before giving up.
 *
 * Measured over 12 real improvements: 6.5s–10.4s. The ceiling is set well
 * above that because the cost of waiting a little longer is smaller than the
 * cost of throwing away an answer that was about to arrive — but it must exist,
 * or a hung stream would hang the dialog with it.
 */
const TIMEOUT_MS = 20_000;

/**
 * Pull the final answer out of the NDJSON stream.
 *
 * The response is a sequence of JSON objects, one per line: a `CHANNEL_ID`
 * first, then `ANSWER_PART` fragments as the model types, then one
 * `FINAL_RESPONSE` carrying the whole thing. Only the last matters — the parts
 * are deliberately ignored, since a fragment can split mid-token. An `ERROR`
 * line can appear instead, and arrives with HTTP 200, so the status code alone
 * says nothing.
 */
function readStream(text: string): ChildIssue[] | null {
  let final: string | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        message?: { content?: string };
      };
      if (event.type === 'FINAL_RESPONSE') final = event.message?.content ?? null;
      if (event.type === 'ERROR') return null;
    } catch {
      // A partial line is not a failure of the whole stream.
    }
  }
  if (!final) return null;
  try {
    const parsed = JSON.parse(final) as { childIssues?: ChildIssue[] };
    return parsed.childIssues ?? [];
  } catch {
    return null;
  }
}

/**
 * The QA line among the suggestions, if the AI offered one.
 *
 * It usually does not label things consistently — observed shapes include
 * `QA_Kiểm tra ...`, `QA: Kiểm tra ...` and `[APP] QA kiểm tra ...` — and
 * roughly a third of the time it suggests only development work, or nothing at
 * all. So this looks for a QA marker first and falls back to a line that reads
 * like testing.
 */
function pickQaLine(items: ChildIssue[]): string | null {
  const summaries = items.map((item) => item.summary?.trim()).filter(Boolean) as string[];
  const labelled = summaries.find((summary) => /(^|[\s\]])QA\b/i.test(summary));
  if (labelled) return labelled;
  return summaries.find((summary) => /\b(test|kiểm tra|verify)\b/i.test(summary)) ?? null;
}

/**
 * Strip whatever prefix the AI chose, leaving just the description of the work.
 *
 * The house format is rebuilt by the caller, so anything the model put in front
 * — its own `QA_`/`QA:` marker, a `[BO]`/`[APP]` tag, even a `YYMMDD` stamp it
 * copied from a sibling sub-task — has to come off first, or the title ends up
 * with two of each.
 */
function stripPrefixes(summary: string): string {
  let body = summary.trim();
  body = body.replace(/^\[[^\]]*\]\s*/, '');
  body = body.replace(/^QA[_\s]*\d{6}\s*[:：]?\s*/i, '');
  body = body.replace(/^QA\s*[_:：-]\s*/i, '');
  body = body.replace(/^QA\s+(?=[a-zà-ỹ])/i, '');
  body = body.replace(/^(test|kiểm tra|verify)\s+/i, '');
  return body.trim();
}

export interface QaSuggestion {
  /** Body of the work, with every prefix removed — ready to drop after "Test ". */
  body: string;
  /** Exactly what the AI returned, so the UI can show what it is based on. */
  raw: string;
}

/**
 * A suggested QA title body for one issue, or null when there is nothing usable.
 *
 * Null is an ordinary outcome, not an error: measured on 12 real improvements,
 * 4 produced no suggestion at all and 4 more suggested only development work.
 * Callers fall back to the default title rather than showing a failure.
 */
export async function suggestQaTitle(issueKey: string): Promise<QaSuggestion | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://${config.jira.site}${WORK_BREAKDOWN}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json;charset=UTF-8',
        // Both required. The endpoint rejects unknown experience ids outright.
        'X-Experience-Id': 'issue-work-breakdown',
        'X-Product': 'jira-software',
      },
      body: JSON.stringify({ ai_feature_input: { issueKey } }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const items = readStream(await response.text());
    if (!items || items.length === 0) return null;

    const line = pickQaLine(items);
    if (!line) return null;

    const body = stripPrefixes(line);
    // A prefix-only line ("QA:") leaves nothing to say.
    return body ? { body, raw: line } : null;
  } catch {
    // Timeout, network trouble, or Atlassian changing the endpoint. All the
    // same to the caller: no suggestion this time.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
