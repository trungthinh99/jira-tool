import type {
  IssueSummary,
  PostedReport,
  ReportPayload,
  ReportTarget,
  TransitionOption,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error((body as { error?: string })?.error ?? `Lỗi ${response.status}`);
  }
  return body as T;
}

export const api = {
  targets: () => request<ReportTarget[]>('/targets'),

  inbox: () => request<{ issues: IssueSummary[] }>('/inbox'),

  activity: (date: string) =>
    request<{ date: string; issues: IssueSummary[] }>(
      `/activity?date=${encodeURIComponent(date)}`,
    ),

  previousNextTasks: (targetId: string) =>
    request<{ nextTasks: string[] }>(`/targets/${targetId}/previous-next-tasks`),

  preview: (targetId: string, payload: ReportPayload) =>
    request<{ text: string; adf: unknown }>(`/targets/${targetId}/preview`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  postReport: (targetId: string, payload: ReportPayload) =>
    request<PostedReport>(`/targets/${targetId}/report`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  transitions: (issueKey: string) =>
    request<{ transitions: TransitionOption[] }>(
      `/issues/${encodeURIComponent(issueKey)}/transitions`,
    ),

  transition: (issueKey: string, toStatus: string) =>
    request<{ ok: boolean }>(`/issues/${encodeURIComponent(issueKey)}/transition`, {
      method: 'POST',
      body: JSON.stringify({ toStatus }),
    }),
};
