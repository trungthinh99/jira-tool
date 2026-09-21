import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { IssueSummary } from '../api/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  Spinner,
  statusTone,
} from '../components/ui';
import { SOURCE_LABEL, formatDateTime, readSeen, taskSource, writeSeen } from '../utils';
import type { TaskSource } from '../utils';

const REFRESH_MS = 5 * 60 * 1000;
const GROUP_ORDER: TaskSource[] = ['backend', 'ba', 'tester', 'other'];

export function InboxPage() {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  // Snapshot of what had been seen when the page mounted, so the "mới" badge
  // survives the refresh that immediately marks everything as seen.
  const seenAtMount = useRef<Set<string>>(readSeen());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { issues: fetched } = await api.inbox();
      setIssues(fetched);
      setLastLoaded(new Date());
      writeSeen(new Set(fetched.map((issue) => issue.key)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được danh sách.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const start = async (issueKey: string) => {
    setBusyKey(issueKey);
    try {
      await api.transition(issueKey, 'In Progress');
      setIssues((current) => current.filter((issue) => issue.key !== issueKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không chuyển được trạng thái.');
    } finally {
      setBusyKey(null);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<TaskSource, IssueSummary[]>();
    for (const issue of issues) {
      const source = taskSource(issue);
      const bucket = map.get(source);
      if (bucket) bucket.push(issue);
      else map.set(source, [issue]);
    }
    return GROUP_ORDER.filter((source) => map.has(source)).map((source) => ({
      source,
      items: map.get(source) ?? [],
    }));
  }, [issues]);

  const newCount = issues.filter((issue) => !seenAtMount.current.has(issue.key)).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Task mới được phân
              <Badge tone="brand">{issues.length}</Badge>
              {newCount > 0 ? <Badge tone="warning">{newCount} mới</Badge> : null}
            </span>
          }
          subtitle={
            lastLoaded
              ? `Trạng thái To Do · cập nhật lúc ${lastLoaded.toLocaleTimeString('vi-VN')}`
              : 'Trạng thái To Do'
          }
          actions={
            <Button size="sm" onClick={() => void load()} disabled={loading}>
              Làm mới
            </Button>
          }
        />

        {error ? (
          <div className="px-4 pt-3">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {loading && issues.length === 0 ? <Spinner /> : null}

        {!loading && issues.length === 0 && !error ? (
          <EmptyState message="Không có task nào đang chờ. 🎉" />
        ) : null}

        {groups.map(({ source, items }) => (
          <div key={source} className="border-t border-line first:border-t-0">
            <h3 className="bg-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {SOURCE_LABEL[source]} · {items.length}
            </h3>
            <ul>
              {items.map((issue) => (
                <li
                  key={issue.key}
                  className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0 hover:bg-canvas/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs font-semibold text-brand hover:underline"
                      >
                        {issue.key}
                      </a>
                      <Badge>{issue.projectKey}</Badge>
                      <Badge tone={statusTone(issue.statusCategory)}>{issue.status}</Badge>
                      {!seenAtMount.current.has(issue.key) ? (
                        <Badge tone="warning">mới</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm">{issue.summary}</p>
                    <p className="mt-1 text-xs text-muted">
                      {issue.parentKey ? (
                        <>
                          Thuộc{' '}
                          <span className="font-mono">{issue.parentKey}</span>
                          {issue.parentSummary ? ` · ${issue.parentSummary}` : ''} ·{' '}
                        </>
                      ) : null}
                      {issue.reporter ? `Tạo bởi ${issue.reporter} · ` : ''}
                      {formatDateTime(issue.created)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busyKey === issue.key}
                    onClick={() => void start(issue.key)}
                  >
                    {busyKey === issue.key ? 'Đang chuyển…' : 'Bắt đầu'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}
