import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { IssueSummary, ReportTarget } from '../api/types';
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
import {
  SOURCE_LABEL,
  cn,
  copyText,
  formatDateTime,
  groupProjectInbox,
  readSeen,
  writeSeen,
} from '../utils';

const REFRESH_MS = 5 * 60 * 1000;

/** Sentinel filter values — real assignee names can never collide with these. */
const ALL = '__all__';
const MINE = '__mine__';

export function InboxPage({ targets }: { targets: ReportTarget[] }) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [activeId, setActiveId] = useState(targets[0]?.id ?? '');

  // Stories the user has folded away. Everything starts folded; a story that
  // appears on a later refresh shows up open, which is what makes new work
  // visible without a click.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Filters. The defaults reproduce the old fixed query — To Do, assigned to
  // me — so the screen opens on the list it always showed.
  const [statusFilter, setStatusFilter] = useState('To Do');
  const [assigneeFilter, setAssigneeFilter] = useState<string>(MINE);
  const [me, setMe] = useState<string | null>(null);

  /** Key of the group whose links were just copied, for the button feedback. */
  const [copied, setCopied] = useState<string | null>(null);

  // Snapshot of what had been seen when the page mounted, so the "mới" badge
  // survives the refresh that immediately marks everything as seen.
  const seenAtMount = useRef<Set<string>>(readSeen());

  // Stories are folded on the first load only. The five-minute auto-refresh
  // and the Làm mới button run the same function, and neither may fold away
  // what the user has opened while reading.
  const foldedOnce = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { issues: fetched } = await api.inbox();
      setIssues(fetched);
      setLastLoaded(new Date());
      if (!foldedOnce.current) {
        foldedOnce.current = true;
        setCollapsed(new Set(groupProjectInbox(fetched).stories.map((s) => s.parentKey)));
      }
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

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setMe(user.displayName))
      .catch(() => setMe(null));
  }, []);

  const start = async (issueKey: string) => {
    setBusyKey(issueKey);
    try {
      await api.transition(issueKey, 'In Progress');
      // The query keeps In Progress now, so patch the row in place rather than
      // dropping it — it is still open work, just further along.
      setIssues((current) =>
        current.map((issue) =>
          issue.key === issueKey
            ? { ...issue, status: 'In Progress', statusCategory: 'indeterminate' }
            : issue,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không chuyển được trạng thái.');
    } finally {
      setBusyKey(null);
    }
  };

  /** Everyone with work on this board, for the assignee dropdown. */
  const assignees = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const name = issue.assignee ?? 'Chưa giao';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  /** Statuses present on this board, for the status dropdown. */
  const statuses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [issues]);

  const matchesFilters = useCallback(
    (issue: IssueSummary) => {
      if (statusFilter !== ALL && issue.status !== statusFilter) return false;
      if (assigneeFilter === ALL) return true;
      const name = issue.assignee ?? 'Chưa giao';
      return assigneeFilter === MINE ? name === me : name === assigneeFilter;
    },
    [statusFilter, assigneeFilter, me],
  );

  const byTarget = useMemo(() => {
    const map = new Map<string, IssueSummary[]>();
    for (const target of targets) {
      map.set(
        target.id,
        issues.filter(
          (issue) => issue.projectKey === target.projectKey && matchesFilters(issue),
        ),
      );
    }
    return map;
  }, [issues, targets, matchesFilters]);

  const active = targets.find((target) => target.id === activeId) ?? targets[0];

  // Issues from a project no target covers would otherwise vanish behind the tabs.
  const uncovered = useMemo(() => {
    const covered = new Set(targets.map((target) => target.projectKey));
    return issues.filter((issue) => !covered.has(issue.projectKey));
  }, [issues, targets]);

  const grouped = useMemo(
    () => groupProjectInbox(active ? (byTarget.get(active.id) ?? []) : []),
    [byTarget, active],
  );

  const newCount = issues.filter((issue) => !seenAtMount.current.has(issue.key)).length;

  const isNew = (key: string) => !seenAtMount.current.has(key);

  /**
   * Copy one link per line, so the list can be pasted straight into a chat and
   * read as a column rather than a run-on paragraph.
   */
  const copyLinks = async (groupKey: string, items: IssueSummary[]) => {
    const ok = await copyText(items.map((issue) => issue.url).join('\n'));
    if (!ok) {
      setError('Không copy được vào clipboard.');
      return;
    }
    setCopied(groupKey);
    window.setTimeout(() => setCopied((current) => (current === groupKey ? null : current)), 1800);
  };

  const toggleStory = (parentKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(parentKey)) next.delete(parentKey);
      else next.add(parentKey);
      return next;
    });
  };

  // "Expand all" only has to clear the set; collapsing needs every story key
  // currently on screen, so a story from the other tab keeps its own state.
  const allCollapsed =
    grouped.stories.length > 0 &&
    grouped.stories.every((story) => collapsed.has(story.parentKey));

  const toggleAll = () => {
    setCollapsed((current) => {
      if (allCollapsed) {
        const next = new Set(current);
        for (const story of grouped.stories) next.delete(story.parentKey);
        return next;
      }
      return new Set([...current, ...grouped.stories.map((story) => story.parentKey)]);
    });
  };

  /** One task row — shared by the story groups and the standalone lists. */
  const renderIssue = (issue: IssueSummary, nested: boolean) => (
    <li
      key={issue.key}
      className={cn(
        'flex items-start gap-3 border-t border-line py-3 pr-4 hover:bg-raised',
        nested ? 'pl-8' : 'pl-4',
      )}
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
          <Badge tone={statusTone(issue.statusCategory)}>{issue.status}</Badge>
          {isNew(issue.key) ? <Badge tone="warning">mới</Badge> : null}
        </div>
        <p className="mt-1 text-sm">{issue.summary}</p>
        <p className="mt-1 text-xs text-muted">
          <span title="Người tạo → người được giao">
            {issue.reporter ?? '—'}
            <span className="px-1 opacity-60">→</span>
            <span className="text-ink">{issue.assignee ?? 'chưa giao'}</span>
          </span>
          {' · '}
          {formatDateTime(issue.created)}
        </p>
      </div>
      {/* Only a To Do task can be started; the rest are already under way. */}
      {issue.status === 'To Do' ? (
        <Button
          size="sm"
          variant="primary"
          disabled={busyKey === issue.key}
          onClick={() => void start(issue.key)}
        >
          {busyKey === issue.key ? 'Đang chuyển…' : 'Bắt đầu'}
        </Button>
      ) : null}
    </li>
  );

  if (!active) return <ErrorBanner message="Chưa cấu hình report target nào." />;

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
              ? `Task chưa hoàn thành · cập nhật lúc ${lastLoaded.toLocaleTimeString('vi-VN')}`
              : 'Task chưa hoàn thành'
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

        <nav className="flex items-center gap-1 border-t border-line px-4 py-2">
          {targets.map((target) => {
            const items = byTarget.get(target.id) ?? [];
            const fresh = items.filter((issue) => isNew(issue.key)).length;
            return (
              <button
                key={target.id}
                onClick={() => setActiveId(target.id)}
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition',
                  target.id === active.id
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted hover:bg-raised hover:text-ink',
                )}
              >
                {target.label}
                <Badge tone={target.id === active.id ? 'brand' : 'neutral'}>
                  {items.length}
                </Badge>
                {fresh > 0 ? <Badge tone="warning">{fresh} mới</Badge> : null}
              </button>
            );
          })}

          {grouped.stories.length > 1 ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={toggleAll}>
              {allCollapsed ? 'Mở hết' : 'Thu hết'}
            </Button>
          ) : null}
        </nav>

        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised px-4 py-2.5">
          <label className="text-xs text-muted">Trạng thái</label>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-7 rounded border border-line bg-surface px-2 text-xs"
          >
            <option value={ALL}>Tất cả ({issues.length})</option>
            {statuses.map(([status, count]) => (
              <option key={status} value={status}>
                {status} ({count})
              </option>
            ))}
          </select>

          <label className="ml-2 text-xs text-muted">Người làm</label>
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="h-7 rounded border border-line bg-surface px-2 text-xs"
          >
            {me ? <option value={MINE}>{me} (tôi)</option> : null}
            <option value={ALL}>Tất cả ({issues.length})</option>
            {assignees
              .filter(([name]) => name !== me)
              .map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
          </select>

          {statusFilter !== 'To Do' || assigneeFilter !== MINE ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatusFilter('To Do');
                setAssigneeFilter(MINE);
              }}
            >
              Mặc định
            </Button>
          ) : null}

          <span className="ml-auto text-xs text-muted">
            Hiện {grouped.total}/{issues.length} task
          </span>
          {grouped.total > 0 ? (
            <Button
              size="sm"
              title={`Copy ${grouped.total} link đang hiện của ${active.label}`}
              onClick={() => void copyLinks('__board__', byTarget.get(active.id) ?? [])}
            >
              {copied === '__board__' ? '✓ Đã copy' : 'Lấy hết link'}
            </Button>
          ) : null}
        </div>
      </Card>

      {uncovered.length > 0 ? (
        <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {uncovered.length} task thuộc dự án chưa cấu hình ({' '}
          {[...new Set(uncovered.map((issue) => issue.projectKey))].join(', ')}) — không nằm
          trong tab nào.
        </div>
      ) : null}

      <Card>
        {loading && issues.length === 0 ? <Spinner /> : null}

        {!loading && grouped.total === 0 && !error ? (
          <EmptyState
            message={
              issues.length === 0
                ? 'Không có task nào đang chờ. 🎉'
                : `Không có task ${active.label} nào đang chờ.`
            }
          />
        ) : null}

        {/* Sub-tasks, collected under the story they were split from. */}
        {grouped.stories.map((story) => {
          const open = !collapsed.has(story.parentKey);
          const fresh = story.items.filter((issue) => isNew(issue.key)).length;
          return (
            <section key={story.parentKey} className="border-t border-line first:border-t-0">
              <header className="flex items-center gap-2 bg-raised pr-4">
                <button
                  onClick={() => toggleStory(story.parentKey)}
                  aria-expanded={open}
                  title={open ? 'Thu gọn' : 'Mở ra'}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4 text-left hover:text-brand"
                >
                  <span
                    className={cn(
                      'shrink-0 text-[10px] text-muted transition-transform',
                      open && 'rotate-90',
                    )}
                  >
                    ▶
                  </span>
                  <span className="shrink-0 font-mono text-xs font-semibold text-brand">
                    {story.parentKey}
                  </span>
                  {story.parentStatus ? (
                    <Badge tone={statusTone(story.parentStatusCategory ?? '')}>
                      {story.parentStatus}
                    </Badge>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {story.parentSummary ?? '(không có tiêu đề)'}
                  </span>
                </button>
                {fresh > 0 && !open ? <Badge tone="warning">{fresh} mới</Badge> : null}
                <span className="shrink-0 text-xs text-muted">{story.items.length} sub-task</span>
                <Button
                  size="sm"
                  variant="ghost"
                  title={`Copy ${story.items.length} link sub-task đang hiện`}
                  onClick={() => void copyLinks(story.parentKey, story.items)}
                >
                  {copied === story.parentKey ? '✓ Đã copy' : 'Lấy link'}
                </Button>
                <a
                  href={`${active.reportIssueUrl.split('/browse/')[0]}/browse/${story.parentKey}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Mở ${story.parentKey} trên Jira`}
                  className="shrink-0 text-xs text-muted hover:text-brand"
                >
                  ↗
                </a>
              </header>
              {open ? <ul>{story.items.map((issue) => renderIssue(issue, true))}</ul> : null}
            </section>
          );
        })}

        {/* Improvements and bugs stand on their own — no story to nest under. */}
        {grouped.loose.map(({ source, items }) => (
          <section key={source} className="border-t border-line first:border-t-0">
            <header className="flex items-center gap-2 bg-raised py-2 pl-4 pr-4">
              <h3 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {SOURCE_LABEL[source]} · {items.length}
              </h3>
              <Button
                size="sm"
                variant="ghost"
                title={`Copy ${items.length} link đang hiện`}
                onClick={() => void copyLinks(source, items)}
              >
                {copied === source ? '✓ Đã copy' : 'Lấy link'}
              </Button>
            </header>
            <ul>{items.map((issue) => renderIssue(issue, false))}</ul>
          </section>
        ))}
      </Card>
    </div>
  );
}
