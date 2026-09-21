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
