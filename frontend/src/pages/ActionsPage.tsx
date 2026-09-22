import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { BulkResult, IssueSummary, JiraUser, ReportTarget } from '../api/types';
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
import { ROLE_LABEL, cn, groupProjectInbox, taskRole } from '../utils';
import type { TaskRole } from '../utils';
import { CreateQaDialog, type QaParent } from './CreateQaDialog';

/** Statuses a sub-task can be pushed to, in workflow order. */
const STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];

/** Role badge colours — BE is someone else's work, FE is mine. */
const ROLE_TONE: Record<TaskRole, 'neutral' | 'brand' | 'success' | 'warning'> = {
  be: 'warning',
  fe: 'brand',
  qa: 'success',
  other: 'neutral',
};

export function ActionsPage({ targets }: { targets: ReportTarget[] }) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(targets[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toStatus, setToStatus] = useState('Review');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [qaParent, setQaParent] = useState<QaParent | null>(null);

  /** Which project has already had its stories folded for the user. */
  const foldedFor = useRef<string | null>(null);

  const active = targets.find((target) => target.id === activeId) ?? targets[0];

  /**
   * `afterWrite` marks the reload that follows a bulk move or a QA creation:
   * it refreshes the data but leaves the user's view alone — the result banner,
   * what they had ticked, and which stories they had opened.
   */
  const load = useCallback(async (targetId: string, opts: { afterWrite?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    if (!opts.afterWrite) setResults(null);
    try {
      const { issues: fetched } = await api.handover(targetId);
      setIssues(fetched);
      // Stories start folded the first time a project is opened. A manual
      // refresh or a post-write reload must not fold away what the user opened.
      if (foldedFor.current !== targetId) {
        foldedFor.current = targetId;
        setCollapsed(new Set(groupProjectInbox(fetched).stories.map((s) => s.parentKey)));
      }
      // Nothing is ticked on arrival — every action here writes to Jira, so the
      // user picks deliberately. After a write we keep what was picked, minus
      // whatever left the board.
      setSelected((current) =>
        opts.afterWrite
          ? new Set(fetched.map((i) => i.key).filter((key) => current.has(key)))
          : new Set(),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được danh sách.');
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load(active.id);
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api
      .users(active.id)
      .then(({ users: fetched }) => {
        if (!cancelled) setUsers(fetched);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const grouped = useMemo(() => groupProjectInbox(issues), [issues]);

  // Improvements and bugs have no FE/BE split — they get a QA button directly.
  const standalone = useMemo(
    () => grouped.loose.flatMap((group) => group.items),
    [grouped],
  );

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setMany = (keys: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const toggleStory = (parentKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(parentKey)) next.delete(parentKey);
      else next.add(parentKey);
      return next;
    });
  };

  /** Tick every sub-task of one role across the whole board. */
  const selectRole = (role: TaskRole) => {
    setSelected(new Set(issues.filter((issue) => taskRole(issue) === role).map((i) => i.key)));
  };

  /**
   * Tick one role inside a single story, replacing that story's selection but
   * leaving other stories alone — the flow moves one story at a time.
   */
  const selectRoleInStory = (items: IssueSummary[], role: TaskRole) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const issue of items) {
        if (taskRole(issue) === role) next.add(issue.key);
        else next.delete(issue.key);
      }
      return next;
    });
  };

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

  const run = async () => {
    const keys = [...selected];
    if (keys.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { results: outcome } = await api.transitionMany(keys, toStatus);
      setResults(outcome);
      // Reload so statuses and the Done filter are accurate again, keeping the
      // result banner the user has not read yet.
      if (active) await load(active.id, { afterWrite: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không chuyển được trạng thái.');
    } finally {
      setBusy(false);
    }
  };

  if (!active) return <ErrorBanner message="Chưa cấu hình report target nào." />;

  const failed = results?.filter((result) => !result.ok) ?? [];
  const succeeded = results?.filter((result) => result.ok) ?? [];

  const renderRow = (issue: IssueSummary, nested: boolean) => {
    const role = taskRole(issue);
    return (
      <li
        key={issue.key}
        className={cn(
          'flex items-start gap-3 border-t border-line py-2.5 pr-4 hover:bg-raised',
          nested ? 'pl-8' : 'pl-4',
        )}
      >
        <input
          type="checkbox"
          checked={selected.has(issue.key)}
          onChange={() => toggle(issue.key)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs font-semibold text-brand hover:underline"
            >
              {issue.key}
            </a>
            <Badge tone={statusTone(issue.statusCategory)}>{issue.status}</Badge>
            {/* Creator → assignee. Both matter here: Jame creates the BE
                sub-tasks, but the handover is about whose hands each one is
                in right now. */}
            <span className="text-xs text-muted" title="Người tạo → người được giao">
              {issue.reporter ?? '—'}
              <span className="px-1 opacity-60">→</span>
              <span className="text-ink">{issue.assignee ?? 'chưa giao'}</span>
            </span>
          </div>
          <p className="mt-1 text-sm">{issue.summary}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          title="Tạo task QA dưới issue này"
          onClick={() => setQaParent(issue)}
        >
          + QA
        </Button>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Thao tác"
          subtitle="Chuyển trạng thái hàng loạt theo quy trình bàn giao, và tạo task QA."
          actions={
            <Button size="sm" onClick={() => void load(active.id)} disabled={loading || busy}>
              Làm mới
            </Button>
          }
        />

        <nav className="flex items-center gap-1 border-t border-line px-4 py-2">
          {targets.map((target) => (
            <button
              key={target.id}
              onClick={() => setActiveId(target.id)}
              className={cn(
                'rounded px-3 py-1.5 text-sm font-medium transition',
                target.id === active.id
                  ? 'bg-brand-soft text-brand'
                  : 'text-muted hover:bg-raised hover:text-ink',
              )}
            >
              {target.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">{issues.length} task chưa xong</span>
          {grouped.stories.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {allCollapsed ? 'Mở hết' : 'Thu hết'}
            </Button>
          ) : null}
        </nav>

        {/* Bulk bar. The flow's two common moves are one click each. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised px-4 py-2.5">
          <span className="text-xs text-muted">Chọn nhanh:</span>
          <Button size="sm" onClick={() => selectRole('be')}>
            Task BE
          </Button>
          <Button size="sm" onClick={() => selectRole('fe')}>
            Task FE
          </Button>
          <Button size="sm" onClick={() => setMany(issues.map((i) => i.key), true)}>
            Tất cả
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>

          <span className="ml-auto flex items-center gap-2">
            <Badge tone={selected.size > 0 ? 'brand' : 'neutral'}>
              {selected.size} đã chọn
            </Badge>
            <select
              value={toStatus}
              onChange={(event) => setToStatus(event.target.value)}
              className="h-7 rounded border border-line bg-surface px-2 text-xs"
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  → {status}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={selected.size === 0 || busy}
              onClick={() => void run()}
            >
              {busy ? 'Đang chuyển…' : `Chuyển ${selected.size} task`}
            </Button>
          </span>
        </div>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void load(active.id)} /> : null}

      {results ? (
        <div
          className={cn(
            'rounded border px-3 py-2.5 text-sm',
            failed.length === 0
              ? 'border-success/30 bg-success/10'
              : 'border-warning/30 bg-warning/10',
          )}
        >
          <p className={failed.length === 0 ? 'text-success' : 'text-warning'}>
            Chuyển xong {succeeded.length}/{results.length} task.
          </p>
          {failed.map((result) => (
            <p key={result.key} className="mt-1 text-xs text-danger">
              <span className="font-mono">{result.key}</span>: {result.error}
            </p>
          ))}
        </div>
      ) : null}

      <Card>
        {loading && issues.length === 0 ? <Spinner /> : null}

        {!loading && issues.length === 0 && !error ? (
          <EmptyState message="Không có task nào đang chờ xử lý. 🎉" />
        ) : null}

        {grouped.stories.map((story) => {
          const open = !collapsed.has(story.parentKey);
          const keys = story.items.map((issue) => issue.key);
          const allOn = keys.every((key) => selected.has(key));
          const picked = keys.filter((key) => selected.has(key)).length;
          const roles = new Set(story.items.map((issue) => taskRole(issue)));
          return (
            <section key={story.parentKey} className="border-t border-line first:border-t-0">
              <header className="flex items-center gap-2 bg-raised pr-4">
                <input
                  type="checkbox"
                  checked={allOn}
                  // Partly-picked shows a dash rather than an empty box, which
                  // would read as "nothing selected here".
                  ref={(node) => {
                    if (node) node.indeterminate = picked > 0 && !allOn;
                  }}
                  onChange={() => setMany(keys, !allOn)}
                  title="Chọn cả nhóm"
                  className="ml-4 h-4 w-4 shrink-0 accent-brand"
                />
                <button
                  onClick={() => toggleStory(story.parentKey)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left hover:text-brand"
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
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {story.parentSummary ?? '(không có tiêu đề)'}
                  </span>
                </button>
                {/* Per-story quick picks: the handover moves one story's BE
                    sub-tasks, then that same story's FE ones. */}
                {roles.has('be') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Chỉ chọn task BE của story này"
                    onClick={() => selectRoleInStory(story.items, 'be')}
                  >
                    BE
                  </Button>
                ) : null}
                {roles.has('fe') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Chỉ chọn task FE của story này"
                    onClick={() => selectRoleInStory(story.items, 'fe')}
                  >
                    FE
                  </Button>
                ) : null}
                <span className="shrink-0 text-xs text-muted">
                  {picked > 0 ? `${picked}/${story.items.length}` : story.items.length}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  title={`Tạo task QA dưới ${story.parentKey}`}
                  onClick={() =>
                    setQaParent({
                      key: story.parentKey,
                      summary: story.parentSummary ?? story.parentKey,
                    })
                  }
                >
                  + QA
                </Button>
              </header>
              {open ? <ul>{story.items.map((issue) => renderRow(issue, true))}</ul> : null}
            </section>
          );
        })}

        {standalone.length > 0 ? (
          <section className="border-t border-line first:border-t-0">
            <h3 className="bg-raised px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Improvement / Bug · {standalone.length}
            </h3>
            <ul>{standalone.map((issue) => renderRow(issue, false))}</ul>
          </section>
        ) : null}
      </Card>

      {qaParent ? (
        <CreateQaDialog
          parent={qaParent}
          users={users}
          defaultAssignee={active.mentions.find((m) => m.name === 'sney') ?? active.mentions[0]}
          onClose={() => setQaParent(null)}
          onCreated={(issue) => {
            setQaParent(null);
            setResults([{ key: issue.key, ok: true }]);
            void load(active.id, { afterWrite: true });
          }}
        />
      ) : null}
    </div>
  );
}
