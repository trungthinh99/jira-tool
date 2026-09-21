import { config } from '../config.js';

const authHeader = `Basic ${Buffer.from(
  `${config.jira.email}:${config.jira.token}`,
).toString('base64')}`;

export class JiraError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

/**
 * Call the Jira Cloud REST API.
 *
 * Jira reports failures in several shapes (`errorMessages[]`, `errors{}`, or a
 * bare HTML error page from the edge), so the readable message is assembled
 * here once instead of at every call site.
 */
export async function jiraFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `https://${config.jira.site}${path}`;
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new JiraError(response.status, describeError(response.status, parsed), parsed);
  }
  return parsed as T;
}

function describeError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as { errorMessages?: unknown; errors?: unknown };
    if (Array.isArray(record.errorMessages) && record.errorMessages.length > 0) {
      return record.errorMessages.join(' · ');
    }
    if (record.errors && typeof record.errors === 'object') {
      const pairs = Object.entries(record.errors as Record<string, unknown>);
      if (pairs.length > 0) {
        return pairs.map(([field, message]) => `${field}: ${String(message)}`).join(' · ');
      }
    }
  }
  if (typeof body === 'string' && body.trim() && !body.trimStart().startsWith('<')) {
    return body.slice(0, 300);
  }
  return `Jira responded ${status}`;
}
