/**
 * Read the "Next task" lines back out of the most recent report comment, so a
 * new report opens seeded with what was promised yesterday rather than blank.
 *
 * Jira returns these bodies as HTML (the mention nodes make markdown lossy), so
 * this parses HTML rather than ADF. A failure to parse is not an error — the
 * caller falls back to the target's configured defaults.
 */
export function parseNextTasks(html: string): string[] {
  const afterHeading = splitAfterHeading(html, 'Next task');
  if (afterHeading === null) return [];

  // Stop at the "Issue:" heading so the trailing paragraph is not picked up.
  const beforeIssue = afterHeading.split(/<strong>\s*Issue/i)[0] ?? afterHeading;

  const items = [...beforeIssue.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1] ?? ''))
    .map((line) => line.trim())
    .filter(Boolean);

  // A nested <ul> yields an outer <li> that repeats all of its children; drop
  // any line that merely concatenates the others.
  return items.filter((line, _index, all) => !all.some((other) => other !== line && line.includes(other)));
}

/**
 * Read `issue key -> percent` out of the most recent report's "Today task"
 * lines, so a task carried over from yesterday opens at the figure it was last
 * reported at rather than back at the status default.
 *
 * The key is taken from the link's `href`, not the visible text: since
 * 21/09/2026 the lines show the task title and the key appears only in the
 * URL. Older reports print the bare URL, which this still matches.
 */
export function parseTaskPercents(html: string): Map<string, number> {
  const afterHeading = splitAfterHeading(html, 'Today task');
  const region = afterHeading ?? html;
  const beforeNext = region.split(/<strong>\s*Next task/i)[0] ?? region;

  const percents = new Map<string, number>();
  // One list item per reported task; a nested <ul> repeats its children in the
  // outer <li>, which is harmless here because the same pair just re-resolves.
  for (const match of beforeNext.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const line = match[1] ?? '';
    const key = /browse\/([A-Z][A-Z0-9]+-\d+)/i.exec(line)?.[1];
    if (!key) continue;
    // Take the last percent on the line: "80% → 100%" reports the new figure.
    const found = [...stripTags(line).matchAll(/(\d{1,3})\s*%/g)];
    const raw = found.at(-1)?.[1];
    if (raw === undefined) continue;
    const percent = Number(raw);
    if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
      percents.set(key.toUpperCase(), percent);
    }
  }
  return percents;
}

function splitAfterHeading(html: string, heading: string): string | null {
  const pattern = new RegExp(`<strong>\\s*${heading}[^<]*</strong>`, 'i');
  const match = pattern.exec(html);
  if (!match) return null;
  return html.slice(match.index + match[0].length);
}

function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ''));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
