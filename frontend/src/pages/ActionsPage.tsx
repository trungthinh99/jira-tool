import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  cn,
  copyText,
  groupProjectInbox,
  needsQa,
  qaStamp,
  rowBadge,
  taskRole,
  taskSource,
  withoutStaleQa,
} from '../utils';
import type { TaskRole, TaskSource } from '../utils';
import { CreateQaDialog, type QaParent } from './CreateQaDialog';

/**
 * Statuses each kind of issue can be pushed to, in workflow order.
 *
 * Bugs run a different workflow from everything else: `TO FIX → FIXING` where
 * a story has `To Do → In Progress`. Verified against `/project/{key}/statuses`
 * on HWE, DT and SR — all three agree, so this is a site-wide split by issue
 * type, not a per-project one. Offering "In Progress" for a bug fails the whole
 * transition with `No transition to "In Progress"`.
 */
const STORY_STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];
const BUG_STATUSES = ['TO FIX', 'FIXING', 'Review', 'Done'];

function statusesFor(issues: readonly IssueSummary[]): string[] {
  const hasBug = issues.some((issue) => issue.issueType.toLowerCase() === 'bug');
  const hasOther = issues.some((issue) => issue.issueType.toLowerCase() !== 'bug');
  // A mixed selection has no status both sides accept beyond these two.
  if (hasBug && hasOther) return ['Review', 'Done'];
  return hasBug ? BUG_STATUSES : STORY_STATUSES;
}

/**
 * The status category Jira files a status under.
 *
 * Used to patch a row straight after a transition, so the board does not have
 * to wait for Jira's search index to catch up. The names are fixed by the
 * workflow on this site; `transitionIssue` still resolves real transitions by
 * name, so nothing here is a hardcoded id.
 */
function categoryOf(status: string): string {
  if (status === 'Done') return 'done';
  if (status === 'To Do' || status === 'TO FIX') return 'new';
  return 'indeterminate';
}

/**
 * Copy one issue title.
 *
 * A plain `<button>` rather than the shared `Button`: it sits inside a dense
 * row next to the title it copies, and the shared paddings would push the
 * title around. It stays faint until the row is hovered so the list keeps
 * reading as titles, not as a column of buttons.
 *
 * Not nested inside the story's collapse toggle — nesting buttons is invalid
 * HTML and the click would fold the story as well as copy.
 */
function CopyTitle({ text, onFail }: { text: string; onFail: () => void }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    if (!(await copyText(text))) {
      onFail();
      return;
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1400);
  };

  return (
    <button
      type="button"
      title="Copy tiêu đề"
      aria-label="Copy tiêu đề"
      onClick={() => void copy()}
      className={cn(
        'shrink-0 rounded px-1 text-xs leading-none transition',
        'opacity-0 focus:opacity-100 group-hover:opacity-100',
        done ? 'text-success opacity-100' : 'text-muted hover:text-brand',
      )}
    >
      {done ? '✓' : '⧉'}
    </button>
  );
}

/**
 * Sentinel for "bỏ giao" in the assignee dropdown.
 *
 * Not `''`: that is the placeholder meaning nothing has been picked, and
 * unassigning is a deliberate choice that has to be told apart from it.
 */
const UNASSIGN = '-';

/** Role badge colours — BE is someone else's work, FE is mine. */
const ROLE_TONE: Record<TaskRole, 'neutral' | 'brand' | 'success' | 'warning'> = {
  be: 'warning',
  fe: 'brand',
  qa: 'success',
  other: 'neutral',
};

/**
 * Work-type badge colours, for the rows that show a type instead of a role.
 *
 * Only the types actually seen on these boards are coloured; anything else
 * falls back to neutral and still prints its own name. Matched case-insensitively
 * because the site also carries Korean type names.
 */
const TYPE_TONE: Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger'> = {
  improvement: 'brand',
  bug: 'danger',
  story: 'success',
  epic: 'warning',
};

function typeTone(issueType: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  return TYPE_TONE[issueType.toLowerCase()] ?? 'neutral';
}

/**
 * Whether this row is an improvement or a bug — the two that are worked
 * directly, with no FE/BE sub-tasks of their own, and so the two whose QA title
 * has to be written from scratch. Those are the ones worth asking the AI about.
 */
function standaloneSource(issue: IssueSummary): boolean {
  const source = taskSource(issue);
  return source === 'ba' || source === 'tester';
}

export function ActionsPage({ targets }: { targets: ReportTarget[] }) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(targets[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toStatus, setToStatus] = useState('Review');
  /** `''` means nobody picked yet; `'-'` is the explicit "bỏ giao" choice. */
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  /** Which write produced `results`, so the banner names the right action. */
  const [results, setResults] = useState<{ verb: string; items: BulkResult[] } | null>(null);
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [qaParent, setQaParent] = useState<QaParent | null>(null);
  /** Issue key whose QA dialog is waiting on Jira's AI, so the button can say so. */
  const [qaSeeding, setQaSeeding] = useState<string | null>(null);

  /** Which project has already had its stories folded for the user. */
  const foldedFor = useRef<string | null>(null);

  const active = targets.find((target) => target.id === activeId) ?? targets[0];

  /**
   * `afterWrite` marks the reload that follows a bulk move or a QA creation:
   * it refreshes the data but leaves the user's view alone — the result banner,
   * what they had ticked, and which stories they had opened.
   */
  const load = useCallback(
    async (
      targetId: string,
      opts: {
        afterWrite?: boolean;
        justMoved?: ReadonlyMap<string, string>;
        justAssigned?: { keys: ReadonlySet<string>; name: string | null };
        justCreated?: readonly IssueSummary[];
      } = {},
    ) => {
    setLoading(true);
    setError(null);
    if (!opts.afterWrite) setResults(null);
    try {
      const { issues: fetched } = await api.handover(targetId);
      // Jira's search index lags a write, so a row we just moved can come back
      // with its old status. Re-apply what the transition told us; the next
      // plain refresh reads it from the server.
      //
      // A row moved to Done is dropped outright: the board's JQL excludes Done,
      // so the only reason it is still here is the stale index. Leaving it in
      // with a Done badge would be worse than the bug it replaces.
      const moved = opts.justMoved;
      let next =
        moved && moved.size > 0
          ? fetched.flatMap((issue) => {
              const status = moved.get(issue.key);
              if (!status || status === issue.status) return [issue];
              if (categoryOf(status) === 'done' && taskRole(issue) !== 'qa') return [];
              return [{ ...issue, status, statusCategory: categoryOf(status) }];
            })
          : fetched;
      // Same lag, same remedy, for the assignee column. This only rewrites a
      // field, so `next` keeps the same rows either way.
      const assigned = opts.justAssigned;
      if (assigned) {
        next = next.map((issue) =>
          assigned.keys.has(issue.key) ? { ...issue, assignee: assigned.name } : issue,
        );
      }
      // Same lag again, for a QA sub-task that was just created: the JQL cannot
      // see it yet, so the "chưa có QA" badge stays on a story that now has its
      // QA. The created issue is read back through `GET /issue/{key}`, which is
      // not index-backed, so it is trustworthy — add it unless this reload
      // already picked it up.
      const created = opts.justCreated;
      if (created && created.length > 0) {
        const have = new Set(next.map((issue) => issue.key));
        next = [...next, ...created.filter((issue) => !have.has(issue.key))];
      }
      setIssues(next);
      // Stories start folded the first time a project is opened. A manual
      // refresh or a post-write reload must not fold away what the user opened.
      //
      // Improvements are left open even though their QA sub-tasks also group
      // under them: a story hides a dozen FE/BE rows, an improvement hides one
      // QA row, and folding those by default would just hide the thing the
      // board is for.
      if (foldedFor.current !== targetId) {
        foldedFor.current = targetId;
        const grouped = groupProjectInbox(next);
        const loose = new Set(grouped.loose.flatMap((g) => g.items).map((i) => i.key));
        setCollapsed(
          new Set(
            grouped.stories
              .map((s) => s.parentKey)
              .filter((key) => !loose.has(key)),
          ),
        );
      }
      // Nothing is ticked on arrival — every action here writes to Jira, so the
      // user picks deliberately. After a write we keep what was picked, minus
      // whatever left the board.
      // Keyed off `next`, not `fetched`: a row that just left the board must
      // lose its tick too, or the next bulk move silently includes a task that
      // is no longer on screen.
      setSelected((current) =>
        opts.afterWrite
          ? new Set(next.map((issue) => issue.key).filter((key) => current.has(key)))
          : new Set(),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được danh sách.');
      setIssues([]);
    } finally {
      setLoading(false);
    }
    },
    [],
  );

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

  /** How many of each kind the section holds, so a quick-pick that would tick
      nothing is not offered. */
  const standaloneCounts = useMemo(
    () => ({
      ba: standalone.filter((issue) => taskSource(issue) === 'ba').length,
      tester: standalone.filter((issue) => taskSource(issue) === 'tester').length,
    }),
    [standalone],
  );

  /**
   * Sub-tasks belonging to a standalone improvement or bug, by its key.
   *
   * These arrive in the same flat list and `groupProjectInbox` files them as
   * their own story group, which would print the improvement twice — once as a
   * row and once as a group header. They are pulled out here so the row can
   * answer "does this already have its QA" on its own.
   */
  const standaloneKids = useMemo(() => {
    const keys = new Set(standalone.map((issue) => issue.key));
    const map = new Map<string, IssueSummary[]>();
    for (const issue of issues) {
      if (!issue.parentKey || !keys.has(issue.parentKey)) continue;
      const list = map.get(issue.parentKey) ?? [];
      list.push(issue);
      map.set(issue.parentKey, list);
    }
    return map;
  }, [issues, standalone]);

  /** Story groups minus the ones that are really a standalone's children. */
  const storyGroups = useMemo(
    () => grouped.stories.filter((story) => !standaloneKids.has(story.parentKey)),
    [grouped, standaloneKids],
  );

  /**
   * Every task the board actually shows.
   *
   * `issues` also holds the finished QA sub-tasks fetched only to decide the
   * "chưa có QA" badge. Selecting from that list would let a bulk move change a
   * task nobody can see on screen, so all the quick-picks and the count work
   * off this one instead.
   */
  const visible = useMemo(
    () => [
      ...storyGroups.flatMap((story) => withoutStaleQa(story.items)),
      // An improvement or bug, then the QA sub-tasks rendered under it. Both
      // are on screen, so both must be selectable and counted — leaving the
      // children out here is the trap `withoutStaleQa` exists to avoid, only
      // in reverse.
      ...standalone.flatMap((issue) => [
        issue,
        ...withoutStaleQa([...(standaloneKids.get(issue.key) ?? []), issue]).filter(
          (kid) => kid.key !== issue.key,
        ),
      ]),
    ],
    [storyGroups, standalone, standaloneKids],
  );

  /**
   * Statuses the dropdown may offer, decided by what is ticked.
   *
   * With nothing ticked it falls back to the board's own mix, so the control
   * is not empty before the first pick.
   */
  const statusOptions = useMemo(
    () =>
      statusesFor(
        selected.size > 0 ? visible.filter((issue) => selected.has(issue.key)) : visible,
      ),
    [visible, selected],
  );

  // Keep the chosen status legal as the selection changes: ticking a bug while
  // "In Progress" is chosen would otherwise send a transition Jira rejects.
  useEffect(() => {
    if (!statusOptions.includes(toStatus)) {
      setToStatus(statusOptions.includes('Review') ? 'Review' : (statusOptions[0] ?? 'Review'));
    }
  }, [statusOptions, toStatus]);

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
    setSelected(new Set(visible.filter((issue) => taskRole(issue) === role).map((i) => i.key)));
  };

  /**
   * Tick the improvements, or the bugs — the rows of the standalone section,
   * never the QA sub-tasks nested under them.
   *
   * Kept apart because they are different work: an improvement is BA's change
   * request, a bug is a tester's defect, and a bug runs its own workflow
   * (`TO FIX → FIXING`), so a mixed tick leaves only `Review` and `Done` in the
   * dropdown. Picking one kind at a time keeps the full workflow available.
   *
   * Keyed off `taskSource()`, not off `taskRole() === 'other'`. The two agree
   * on today's board but are different questions: a BE/FE sub-task titled in
   * the older unprefixed shape (`[FE] Cắt giao diện ...`, still live on SR —
   * see CLAUDE.md §1b) also reads as role `other`, and ticking Jame's sub-task
   * under a "chọn Improvement" button is exactly the kind of wrong write this
   * screen must not invite.
   */
  const selectSource = (source: TaskSource) => {
    setSelected(
      new Set(
        standalone.filter((issue) => taskSource(issue) === source).map((issue) => issue.key),
      ),
    );
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

  /**
   * Everything "Mở hết" / "Thu hết" acts on: every story, plus every
   * improvement or bug that has sub-tasks of its own. Leaving the latter out
   * would make "Thu hết" lie — on a TMS board most of the rows hang off
   * improvements, not stories.
   *
   * An improvement with no sub-tasks is not listed: it has nothing to fold, so
   * counting it would keep `allCollapsed` false forever and strand the label
   * on "Thu hết".
   */
  const foldable = useMemo(
    () => [
      ...storyGroups.map((story) => story.parentKey),
      ...standalone
        .filter((issue) => {
          const kids = standaloneKids.get(issue.key) ?? [];
          return withoutStaleQa([...kids, issue]).some((kid) => kid.key !== issue.key);
        })
        .map((issue) => issue.key),
    ],
    [storyGroups, standalone, standaloneKids],
  );

  const allCollapsed = foldable.length > 0 && foldable.every((key) => collapsed.has(key));

  const toggleAll = () => {
    setCollapsed((current) => {
      if (allCollapsed) {
        const next = new Set(current);
        for (const key of foldable) next.delete(key);
        return next;
      }
      return new Set([...current, ...foldable]);
    });
  };

  const run = async () => {
    const keys = [...selected];
    if (keys.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { results: outcome } = await api.transitionMany(keys, toStatus);
      setResults({ verb: 'Chuyển', items: outcome });

      // Reload so statuses and the Done filter are accurate again, keeping the
      // result banner the user has not read yet. `justMoved` carries what we
      // know to have changed, which the reload trusts over the stale index.
      const moved = new Map(
        outcome.filter((result) => result.ok).map((result) => [result.key, toStatus]),
      );
      if (active) await load(active.id, { afterWrite: true, justMoved: moved });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không chuyển được trạng thái.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hand every ticked task to one person.
   *
   * No `justMoved` counterpart to the transition flow: assigning never takes a
   * row off the board, and the assignee shown on each row is patched here from
   * what the write reported, so the lagging search index cannot paint the old
   * name back. See CLAUDE.md §4.
   */
  const assign = async () => {
    const keys = [...selected];
    if (keys.length === 0 || assignee === '') return;
    const accountId = assignee === UNASSIGN ? null : assignee;
    const name = users.find((user) => user.accountId === accountId)?.displayName ?? null;

    setBusy(true);
    setError(null);
    try {
      const { results: outcome } = await api.assignMany(keys, accountId);
      setResults({ verb: 'Giao', items: outcome });

      const done = new Set(outcome.filter((result) => result.ok).map((result) => result.key));
      setIssues((current) =>
        current.map((issue) =>
          done.has(issue.key) ? { ...issue, assignee: name } : issue,
        ),
      );
      if (active) await load(active.id, { afterWrite: true, justAssigned: { keys: done, name } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không giao được task.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Open the QA dialog, first asking Jira's AI how to word the title.
   *
   * The wait is deliberate — the dialog opens already filled in rather than
   * rewriting itself under the user's cursor. It costs 6–10s, so the button
   * says what it is doing.
   *
   * Only for improvements and bugs. A story's description accumulates
   * `[Update N]` blocks over months, and the AI summarises the wrong round of
   * work from it; its sub-tasks already carry the wording anyway.
   *
   * A failure here is never fatal: the dialog opens with the house default, as
   * it always did. Measured on 12 real improvements, 8 produced no usable QA
   * suggestion at all, so this path is ordinary, not exceptional.
   */
  const openQaDialog = async (parent: QaParent, askAi: boolean) => {
    if (!askAi) {
      setQaParent(parent);
      return;
    }
    setQaSeeding(parent.key);
    try {
      const seed = await api.qaSeed(parent.key);
      setQaParent({
        ...parent,
        ...(seed.suggestion ? { suggestion: seed.suggestion } : {}),
        ...(seed.reporter ? { reporter: seed.reporter } : {}),
      });
    } catch {
      setQaParent(parent);
    } finally {
      setQaSeeding(null);
    }
  };

  if (!active) return <ErrorBanner message="Chưa cấu hình report target nào." />;

  const failed = results?.items.filter((result) => !result.ok) ?? [];
  const succeeded = results?.items.filter((result) => result.ok) ?? [];

  /**
   * `stamp` is the handover round a QA created from this row would belong to.
   * A nested row inherits its story's round; a standalone improvement or bug
   * carries its own, so it is read from the row itself.
   */
  const renderRow = (
    issue: IssueSummary,
    nested: boolean,
    stamp?: string,
    missingQa?: boolean,
    /** Set on an improvement/bug that has sub-tasks of its own to fold. */
    opts: { fold?: { open: boolean; count: number } } = {},
  ) => {
    const role = taskRole(issue);
    const badge = rowBadge(issue);
    const fold = opts.fold;
    return (
      <li
        key={issue.key}
        className={cn(
          'group flex items-start gap-3 border-t border-line py-2.5 pr-4 hover:bg-raised',
          nested ? 'pl-8' : 'pl-4',
        )}
      >
        {/* The caret column is on every row — a spacer where there is nothing
            to fold — so each checkbox lines up with the others at its level
            and a child still sits to the right of its parent. */}
        {fold ? (
          <button
            onClick={() => toggleStory(issue.key)}
            aria-expanded={fold.open}
            title={fold.open ? `Thu ${fold.count} sub-task` : `Mở ${fold.count} sub-task`}
            className="mt-0.5 w-3 shrink-0 text-[10px] leading-4 text-muted hover:text-brand"
          >
            <span className={cn('inline-block transition-transform', fold.open && 'rotate-90')}>
              ▶
            </span>
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <input
          type="checkbox"
          checked={selected.has(issue.key)}
          onChange={() => toggle(issue.key)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={badge.type ? typeTone(issue.issueType) : ROLE_TONE[role]}
              title={badge.type ? `Work type trên Jira: ${issue.issueType}` : undefined}
            >
              {badge.label}
            </Badge>
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs font-semibold text-brand hover:underline"
            >
              {issue.key}
            </a>
            <Badge tone={statusTone(issue.statusCategory)}>{issue.status}</Badge>
            {missingQa ? (
              <Badge tone="warning" title={`Chưa có task QA_${stamp} cho vòng này`}>
                chưa có QA
              </Badge>
            ) : null}
            {/* Creator → assignee. Both matter here: Jame creates the BE
                sub-tasks, but the handover is about whose hands each one is
                in right now. */}
            <span className="text-xs text-muted" title="Người tạo → người được giao">
              {issue.reporter ?? '—'}
              <span className="px-1 opacity-60">→</span>
              <span className="text-ink">{issue.assignee ?? 'chưa giao'}</span>
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            <span className="min-w-0">{issue.summary}</span>
            <CopyTitle
              text={issue.summary}
              onFail={() => setError('Không copy được vào clipboard.')}
            />
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={qaSeeding !== null}
          title={
            standaloneSource(issue)
              ? 'Tạo task QA dưới issue này — hỏi AI của Jira để gợi ý tiêu đề'
              : 'Tạo task QA dưới issue này'
          }
          onClick={() =>
            void openQaDialog(
              {
                key: issue.key,
                summary: issue.summary,
                stamp: stamp ?? qaStamp([issue]),
              },
              standaloneSource(issue),
            )
          }
        >
          {qaSeeding === issue.key ? 'Đang hỏi AI…' : '+ QA'}
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
          <span className="ml-auto text-xs text-muted">{visible.length} task chưa xong</span>
          {/* Counts everything foldable, not just stories: a TMS board is
              mostly improvements with QA under them, and the button used to be
              missing exactly there. */}
          {foldable.length > 1 ? (
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
          <Button size="sm" onClick={() => selectRole('qa')}>
            Task QA
          </Button>
          {/* After the three handover roles: these pick a different kind of
              row, not a fourth and fifth role. Each is hidden when the board
              has none, like the per-story role buttons. */}
          {standaloneCounts.ba > 0 ? (
            <Button
              size="sm"
              title="Chọn tất cả Improvement (không gồm task QA bên dưới)"
              onClick={() => selectSource('ba')}
            >
              Improvement
            </Button>
          ) : null}
          {standaloneCounts.tester > 0 ? (
            <Button
              size="sm"
              title="Chọn tất cả Bug (không gồm task QA bên dưới)"
              onClick={() => selectSource('tester')}
            >
              Bug
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setMany(visible.map((i) => i.key), true)}>
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
              {statusOptions.map((status) => (
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

        {/* Assigning is its own row: it acts on the same ticked tasks but is a
            different write, and sharing a row invites hitting the wrong one. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised px-4 py-2.5">
          <span className="text-xs text-muted">Giao việc:</span>
          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="h-7 max-w-[14rem] rounded border border-line bg-surface px-2 text-xs"
          >
            <option value="">— Chọn người —</option>
            {users.map((user) => (
              <option key={user.accountId} value={user.accountId}>
                {user.displayName}
              </option>
            ))}
            <option value={UNASSIGN}>Bỏ giao</option>
          </select>
          <Button
            size="sm"
            disabled={selected.size === 0 || assignee === '' || busy}
            onClick={() => void assign()}
          >
            {busy ? 'Đang giao…' : `Giao ${selected.size} task`}
          </Button>
          {users.length === 0 ? (
            <span className="text-xs text-muted">Chưa tải được danh sách người.</span>
          ) : null}
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
            {results.verb} xong {succeeded.length}/{results.items.length} task.
          </p>
          {failed.map((result) => (
            <p key={result.key} className="mt-1 text-xs text-danger">
              <span className="font-mono">{result.key}</span>: {result.error}
            </p>
          ))}
        </div>
      ) : null}

      <Card>
        {loading && visible.length === 0 ? <Spinner /> : null}

        {!loading && visible.length === 0 && !error ? (
          <EmptyState message="Không có task nào đang chờ xử lý. 🎉" />
        ) : null}

        {storyGroups.map((story) => {
          const open = !collapsed.has(story.parentKey);
          // The round and the badge are read from the full list; the rows, the
          // count and the checkboxes work off the visible one.
          const round = qaStamp(story.items);
          const missingQa = needsQa(story.items);
          const items = withoutStaleQa(story.items);
          const keys = items.map((issue) => issue.key);
          const allOn = keys.every((key) => selected.has(key));
          const picked = keys.filter((key) => selected.has(key)).length;
          const roles = new Set(items.map((issue) => taskRole(issue)));
          return (
            <section key={story.parentKey} className="border-t border-line first:border-t-0">
              <header className="group flex items-center gap-2 bg-raised pr-4">
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
                {/* The toggle sizes to its text instead of taking `flex-1`, so
                    the copy button lands right after the title rather than
                    drifting across the row to the badges. The spacer below
                    takes the slack instead. */}
                <button
                  onClick={() => toggleStory(story.parentKey)}
                  aria-expanded={open}
                  className="flex min-w-0 items-center gap-2 py-2 text-left hover:text-brand"
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
                  <span className="min-w-0 truncate text-xs font-medium text-ink">
                    {story.parentSummary ?? '(không có tiêu đề)'}
                  </span>
                </button>
                {story.parentSummary ? (
                  <CopyTitle
                    text={story.parentSummary}
                    onFail={() => setError('Không copy được vào clipboard.')}
                  />
                ) : null}
                <span className="flex-1" />
                {missingQa ? (
                  <Badge tone="warning" title={`Chưa có task QA_${round} cho vòng này`}>
                    chưa có QA
                  </Badge>
                ) : null}
                {/* Per-story quick picks, in handover order: this story's BE
                    sub-tasks, then its FE ones, then the QA it hands to the BA. */}
                {roles.has('be') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Chỉ chọn task BE của story này"
                    onClick={() => selectRoleInStory(items, 'be')}
                  >
                    BE
                  </Button>
                ) : null}
                {roles.has('fe') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Chỉ chọn task FE của story này"
                    onClick={() => selectRoleInStory(items, 'fe')}
                  >
                    FE
                  </Button>
                ) : null}
                {roles.has('qa') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Chỉ chọn task QA của story này"
                    onClick={() => selectRoleInStory(items, 'qa')}
                  >
                    QA
                  </Button>
                ) : null}
                <span className="shrink-0 text-xs text-muted">
                  {picked > 0 ? `${picked}/${items.length}` : items.length}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  title={`Tạo task QA dưới ${story.parentKey}`}
                  onClick={() =>
                    // No AI for a story: see `openQaDialog`.
                    void openQaDialog(
                      {
                        key: story.parentKey,
                        summary: story.parentSummary ?? story.parentKey,
                        stamp: round,
                      },
                      false,
                    )
                  }
                >
                  + QA
                </Button>
              </header>
              {open ? <ul>{items.map((issue) => renderRow(issue, true, round))}</ul> : null}
            </section>
          );
        })}

        {standalone.length > 0 ? (
          <section className="border-t border-line first:border-t-0">
            <h3 className="bg-raised px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {/* Counts the improvements and bugs themselves, not the QA rows
                  nested under them — the heading names what the section is a
                  list of. */}
              Improvement / Bug · {standalone.length}
            </h3>
            <ul>
              {standalone.map((issue) => {
                // Its own QA sub-tasks, if any, decide both the round and
                // whether the badge shows. With none, the round falls back to
                // the improvement's own title, then to today.
                const kids = standaloneKids.get(issue.key) ?? [];
                const family = [...kids, issue];
                const round = qaStamp(family);
                // The QA created from this row renders under it, indented like
                // a story's sub-task. Without this the button looked like it
                // did nothing: the badge cleared but the new task was nowhere
                // on screen.
                const shownKids = withoutStaleQa(family).filter((kid) => kid.key !== issue.key);
                const open = !collapsed.has(issue.key);
                return (
                  <Fragment key={issue.key}>
                    {renderRow(issue, false, round, needsQa(family), {
                      // Only a row that has children gets a caret; the rest
                      // keep their original alignment.
                      ...(shownKids.length > 0
                        ? { fold: { open, count: shownKids.length } }
                        : {}),
                    })}
                    {open ? shownKids.map((kid) => renderRow(kid, true, round)) : null}
                  </Fragment>
                );
              })}
            </ul>
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
            setResults({ verb: 'Tạo', items: [{ key: issue.key, ok: true }] });
            // Show it before the reload finishes, so the "chưa có QA" badge
            // clears on the click rather than a request later.
            setIssues((current) =>
              current.some((row) => row.key === issue.key) ? current : [...current, issue],
            );
            void load(active.id, { afterWrite: true, justCreated: [issue] });
          }}
        />
      ) : null}
    </div>
  );
}
