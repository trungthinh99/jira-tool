import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { IssueSummary, JiraUser, Mention, StoryHeading } from '../api/types';
import { Button, ErrorBanner } from '../components/ui';
import { cn, qaTitleFromStory, todayStamp } from '../utils';

/** `YYMMDD` -> `DD/MM/YYYY`, so the seeded stamp can be sanity-checked by eye. */
function readStamp(stamp: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return stamp;
  return `${match[3]}/${match[2]}/20${match[1]}`;
}

/** One handover round the QA can be created for. */
export interface QaRound {
  /** `YYMMDD`. */
  stamp: string;
  /** How many FE sub-tasks this round covers — shown so the pick is informed. */
  feCount: number;
  /**
   * This round's FE sub-tasks that are not in Review yet.
   *
   * All of them, not just the one `feTask` is built from: a round often has
   * several (DT-198's `261030` has three), and handing one to QA while leaving
   * its siblings behind is exactly the half-done state step 5 avoids. Ones
   * already in Review are left out — moving them again is a write that
   * changes nothing.
   */
  fePending: { key: string; status: string }[];
  /** Whether this round already has a QA, so a second one is not made by accident. */
  hasQa: boolean;
  /**
   * The title built from this round's lone FE sub-task, when it has exactly
   * one. With several there is no single title to copy — see
   * `qaTitleFromFeTask()`.
   */
  feTask?: { key: string; summary: string; qaTitle: string };
}

/** Only what the dialog shows — a story header has no IssueSummary of its own. */
export interface QaParent {
  key: string;
  summary: string;
  /** `YYMMDD` of the handover round this QA belongs to. See `qaStamp()`. */
  stamp: string;
  /** Wording from Jira's AI, when it had something to offer. */
  suggestion?: { body: string; raw: string };
  /**
   * Every round this story was handed over in, newest first.
   *
   * A story can carry several: DT-198 has `261028`, `261030` and `261102` at
   * once, and each needs its own QA. Set only when there is more than one —
   * with a single round there is nothing to choose between, and `stamp`
   * already names it.
   */
  rounds?: QaRound[];
  /**
   * The FE title for `stamp`, used when there is no picker — a single-round
   * story, or an improvement, which has no rounds at all.
   */
  feTask?: QaRound['feTask'];
  /** Who raised the issue — the assignee default for an improvement's QA. */
  reporter?: JiraUser;
  /**
   * The `[New]` / `[Update N]` headings of the story's description.
   *
   * The fallback title is built from these when present, which is what covers a
   * story with several FE sub-tasks — `feTask` is unset there, and the generic
   * default says nothing about the work. Empty for an improvement (it has the
   * AI suggestion instead) and for the six open stories whose description
   * carries no heading.
   *
   * All of them, because each round has its own number: DT-198's rounds
   * `261028`, `261030` and `261102` are updates 1, 2 and 3. A block is matched
   * to its heading by stamp, so each one names the round it really tests.
   */
  headings?: StoryHeading[];
}

/**
 * The title to open with.
 *
 * With a suggestion, the house format is rebuilt around the AI's words rather
 * than used as it came: the AI writes `QA: Kiểm tra ...`, `QA_Test ...` or
 * `[APP] QA kiểm tra ...` depending on the issue, never the `QA_YYMMDD:` shape
 * this team uses, and it does not know the handover round at all.
 *
 * With the story's own `[New]` / `[Update N]` heading, the title is built from
 * that and the story summary. This is the case the FE-task prefill cannot
 * reach: a story whose BE split the round across several FE sub-tasks has no
 * single title to copy, and a story only just written has no sub-tasks at all.
 *
 * The heading is looked up **by this round's stamp**, never just taken from the
 * top. The description holds one heading per round and the numbers differ:
 * DT-198's `261030` is update 2 while its newest is update 3, so using the top
 * one would tell the BA to test update 3 against work that is update 2. Only a
 * round with no heading of its own falls through.
 *
 * Without either, the long-standing default, whose trailing space is where the
 * caret lands so the user can keep typing.
 */
function seedTitle(parent: QaParent, stamp: string): string {
  if (parent.suggestion) {
    return `QA_${stamp}: Test ${parent.suggestion.body}`;
  }
  const heading = parent.headings?.find((item) => item.stamp === stamp);
  if (heading) {
    const built = qaTitleFromStory(parent.summary, heading);
    if (built) return built;
  }
  return `QA_${stamp}: Test giao diện và chức năng `;
}

interface Props {
  /** Story, improvement or bug the QA sub-task is created under. */
  parent: QaParent;
  users: JiraUser[];
  /** Seeded as the assignee — the project's BA. */
  defaultAssignee: Mention | undefined;
  onClose: () => void;
  onCreated: (issue: IssueSummary) => void;
  /**
   * Move these FE sub-tasks to Review — the rest of step 5, once their QA
   * exists. Run by the page, not here, so it shares the one transition path
   * and its stale-index handling (`justMoved`).
   *
   * Only called for rounds whose QA was actually created: moving an FE task to
   * Review while its QA failed would claim a hand-off that did not happen.
   */
  onHandOff: (keys: string[]) => Promise<void>;
}

/** The rounds the dialog can build a QA for, even when there is no picker. */
function roundsOf(parent: QaParent): QaRound[] {
  if (parent.rounds && parent.rounds.length > 0) return parent.rounds;
  // A single-round story, or an improvement, which has no rounds of its own.
  // `fePending` is empty here: this path carries no sub-task statuses, so
  // there is nothing it could honestly offer to move.
  return [
    {
      stamp: parent.stamp,
      feCount: parent.feTask ? 1 : 0,
      hasQa: false,
      fePending: [],
      ...(parent.feTask ? { feTask: parent.feTask } : {}),
    },
  ];
}

/** One QA being composed: a round, its title, and whether it follows the FE task. */
interface Draft {
  stamp: string;
  summary: string;
  followFe: boolean;
  /** The title to restore when "theo task FE cuối" is unticked. */
  stashed: string;
  /** Move this round's FE sub-tasks to Review once the QA is created. */
  moveFe: boolean;
}

function newDraft(parent: QaParent, round: QaRound): Draft {
  const fallback = seedTitle(parent, round.stamp);
  return {
    stamp: round.stamp,
    summary: round.feTask ? round.feTask.qaTitle : fallback,
    followFe: Boolean(round.feTask),
    stashed: fallback,
    // On by default: creating the QA *is* the hand-off, and step 5 of the flow
    // has the FE task reaching Review at that moment. Leaving it off would mean
    // remembering a second manual step every time.
    moveFe: round.fePending.length > 0,
  };
}

export function CreateQaDialog({
  parent,
  users,
  defaultAssignee,
  onClose,
  onCreated,
  onHandOff,
}: Props) {
  const rounds = roundsOf(parent);

  /**
   * Whether the stamps come from real data rather than from today's date.
   *
   * `parent.rounds` is built from stamps found in sub-task titles, and a
   * heading carries the round's date in the description, so either one means
   * the date shown is the handover round's and not a fallback. The heading has
   * to match the stamp on show, not merely exist — a story whose description
   * dates its newest round to last week says nothing about today's fallback.
   */
  const grounded =
    (parent.rounds?.length ?? 0) > 0 ||
    (parent.headings ?? []).some((item) => item.stamp === parent.stamp);

  /**
   * One draft per round being created, in the rounds' own order.
   *
   * A story handed over three times needs three QA sub-tasks, and they are
   * made in one sitting — so every round starts present and is removed with
   * its `−`, rather than added one at a time. Keyed by stamp: a round is
   * either in the list or not, and cannot be in it twice.
   */
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    rounds.map((round) => newDraft(parent, round)),
  );

  const has = (stamp: string) => drafts.some((draft) => draft.stamp === stamp);

  /** Add a round's block back, or drop it — the `+` / `−` on each badge. */
  const toggleRound = (round: QaRound) => {
    setDrafts((current) => {
      if (current.some((draft) => draft.stamp === round.stamp)) {
        return current.filter((draft) => draft.stamp !== round.stamp);
      }
      // Rebuilt from scratch, and re-sorted into the rounds' order so the
      // blocks always read newest-first however they were toggled.
      const next = [...current, newDraft(parent, round)];
      const order = rounds.map((item) => item.stamp);
      return next.sort((a, b) => order.indexOf(a.stamp) - order.indexOf(b.stamp));
    });
  };

  const edit = (stamp: string, patch: Partial<Draft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.stamp === stamp ? { ...draft, ...patch } : draft)),
    );
  };

  /**
   * Tick/untick "theo task FE cuối" for one block.
   *
   * Unticking overwrites the box, and the box is the whole point of the
   * dialog — rebuilding the generic default over hand-typed work would throw
   * it away with no undo. So an untouched FE title is replaced, but an edited
   * one is kept. Ticking always rebuilds from the FE task, or the checkbox
   * would stop meaning what its label says.
   */
  const setFollow = (draft: Draft, feTask: QaRound['feTask'], on: boolean) => {
    if (!feTask) return;
    if (on) {
      edit(draft.stamp, { followFe: true, stashed: draft.summary, summary: feTask.qaTitle });
    } else {
      edit(draft.stamp, {
        followFe: false,
        summary: draft.summary === feTask.qaTitle ? draft.stashed : draft.summary,
      });
    }
  };

  // The reporter wins when there is one: on an improvement, whoever asked for
  // the change is usually the one to verify it. Only a default — across the
  // eight most recent QA sub-tasks on DT, Bimo kept it four times and chose
  // someone else the other four, so the dropdown stays free.
  const [assignee, setAssignee] = useState(
    parent.reporter?.accountId ?? defaultAssignee?.accountId ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  /**
   * Create one sub-task per block.
   *
   * Sequential, not `Promise.all`: these are real writes to Jira, and a burst
   * of them is both harder to read in the issue history and more likely to
   * trip rate limiting.
   *
   * A failure half way through does not undo what already succeeded — there is
   * no transaction here. So each success is reported through `onCreated` as it
   * happens, and the failures are named by round, leaving the dialog open with
   * only the rounds that still need creating.
   */
  const submit = async () => {
    if (drafts.some((draft) => !draft.summary.trim())) {
      setError('Tiêu đề không được để trống.');
      return;
    }
    setBusy(true);
    setError(null);

    const failed: string[] = [];
    const done: string[] = [];
    /** FE keys to move once their round's QA is safely created. */
    const handOff: string[] = [];
    for (const draft of drafts) {
      try {
        const { issue } = await api.createSubtask(
          parent.key,
          draft.summary.trim(),
          assignee || undefined,
        );
        onCreated(issue);
        done.push(draft.stamp);
        // Only now, with this round's QA really created, is its FE work handed
        // over — so only now may it move to Review.
        if (draft.moveFe) {
          const round = rounds.find((item) => item.stamp === draft.stamp);
          for (const fe of round?.fePending ?? []) handOff.push(fe.key);
        }
      } catch (caught) {
        const why = caught instanceof Error ? caught.message : 'lỗi không rõ';
        failed.push(`${readStamp(draft.stamp)}: ${why}`);
      }
    }

    // The outcome is recorded before the hand-off, not after: `onHandOff`
    // reloads the board, and that re-render would land on top of these two
    // updates and drop them — leaving every block still listed and no error
    // shown, as if the failure had not happened.
    if (failed.length > 0) {
      // Keep only what still needs doing, so pressing the button again does
      // not create a second copy of the rounds that worked.
      setDrafts((current) => current.filter((draft) => !done.includes(draft.stamp)));
      setError(
        `Tạo được ${done.length}/${done.length + failed.length} task. Lỗi — ${failed.join(' · ')}`,
      );
      setBusy(false);
    }

    // One transition call for every round that succeeded, after the creates:
    // its own failures are reported by the page's result banner, and they must
    // not make a created QA look like it failed.
    if (handOff.length > 0) await onHandOff(handOff);

    if (failed.length === 0) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-xl shadow-black/50">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Tạo task QA</h2>
          <p className="mt-0.5 text-xs text-muted">
            Sub-task dưới <span className="font-mono">{parent.key}</span> ·{' '}
            {parent.summary.slice(0, 60)}
          </p>
        </header>

        <div className="space-y-3 p-4">
          {/* Shown only when the story really was handed over more than once.
              One round needs no choosing, and a picker with a single option
              would just be another thing to read. */}
          {rounds.length > 1 ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Vòng bàn giao
              </label>
              <div className="flex flex-wrap gap-1.5">
                {rounds.map((item) => {
                  const on = has(item.stamp);
                  return (
                    <button
                      key={item.stamp}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleRound(item)}
                      title={
                        on
                          ? `Bỏ task QA cho vòng ${readStamp(item.stamp)}`
                          : `Thêm task QA cho vòng ${readStamp(item.stamp)}` +
                            (item.hasQa ? ' (vòng này đã có QA)' : '')
                      }
                      className={cn(
                        'rounded border px-2 py-1 text-xs transition',
                        on
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-line text-muted hover:text-ink',
                      )}
                    >
                      <span className="font-mono">{readStamp(item.stamp)}</span>
                      <span className="ml-1.5 opacity-70">{item.feCount} FE</span>
                      {/* A round that already has its QA is the usual reason a
                          second one gets created by mistake. */}
                      {item.hasQa ? <span className="ml-1 text-success">✓</span> : null}
                      <span className="ml-1.5 font-mono font-semibold">{on ? '−' : '+'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Nothing left to create: every round was removed with its `−`. */}
          {drafts.length === 0 ? (
            <p className="rounded border border-dashed border-line px-2.5 py-3 text-center text-xs text-muted">
              Chưa chọn vòng nào. Bấm <span className="font-mono text-ink">+</span> ở trên để
              thêm lại.
            </p>
          ) : null}

          {drafts.map((draft, index) => {
            const round = rounds.find((item) => item.stamp === draft.stamp);
            const feTask = round?.feTask;
            const pending = round?.fePending ?? [];
            return (
              <div
                key={draft.stamp}
                className={cn(
                  // A dashed rule between blocks, never above the first one.
                  index > 0 && 'border-t border-dashed border-line pt-3',
                )}
              >
                {/* The date is always shown: it is the only thing naming which
                    round the title belongs to, now that the note below is
                    gone, and with several blocks it is what tells them apart. */}
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                  Tiêu đề
                  <span className="font-mono text-ink">{readStamp(draft.stamp)}</span>
                  {/* A stamp that fell back to today means nothing carried one
                      — worth flagging, since the title is then guesswork.
                      `stamp === today` is not enough on its own: round `261102`
                      falls on 02/11 and would be reported as missing. The stamp
                      is known to be real if a round was built from a sub-task
                      title (`rounds` is set, or this round has an FE task) or
                      if the story's own heading supplied it. */}
                  {draft.stamp === todayStamp() && !feTask && !grounded ? (
                    <span className="font-normal">(hôm nay — không thấy stamp ở sub-task)</span>
                  ) : null}
                </label>
                <textarea
                  autoFocus={index === 0}
                  value={draft.summary}
                  onChange={(event) => edit(draft.stamp, { summary: event.target.value })}
                  rows={2}
                  className="w-full resize-y rounded border border-line bg-raised p-2.5 text-sm"
                />
                {/* Only offered when there is one FE task for this round: with
                    several, there is no single title to follow. */}
                {feTask ? (
                  <label className="mt-1.5 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draft.followFe}
                      onChange={(event) => setFollow(draft, feTask, event.target.checked)}
                      className="h-3.5 w-3.5 shrink-0 accent-brand"
                    />
                    <span className="text-ink">Theo task FE cuối</span>
                  </label>
                ) : null}
                {/* Hidden when the round has nothing left to move — every FE
                    task already sits in Review, or this is an improvement with
                    no sub-tasks at all. */}
                {pending.length > 0 ? (
                  <label className="mt-1.5 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draft.moveFe}
                      onChange={(event) => edit(draft.stamp, { moveFe: event.target.checked })}
                      className="h-3.5 w-3.5 shrink-0 accent-brand"
                    />
                    <span className="text-ink">
                      Chuyển task FE sang Review
                      {/* Named, because this moves other people's rows too and
                          the count is the only way to see how many. */}
                      <span className="ml-1 text-muted">
                        ({pending.map((fe) => fe.key).join(', ')})
                      </span>
                    </span>
                  </label>
                ) : null}
                {/* No note about the stamp here: the block's own "Tiêu đề
                    DD/MM/YYYY" label already carries the date, and the
                    checkbox names where the title came from. */}
                {/* The AI's own wording, so what the title was built from can be
                    judged — it is paraphrased into the house format above, and a
                    paraphrase is worth checking against its source. */}
                {parent.suggestion ? (
                  <p className="mt-1.5 rounded border border-line bg-canvas px-2.5 py-2 text-xs text-muted">
                    <span className="text-ink">AI gợi ý:</span> {parent.suggestion.raw}
                  </p>
                ) : null}
              </div>
            );
          })}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Giao cho
              {parent.reporter ? (
                <span className="ml-1 font-normal">
                  · mặc định {parent.reporter.displayName} (người tạo issue)
                </span>
              ) : null}
            </label>
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="h-9 w-full rounded border border-line bg-raised px-2 text-sm"
            >
              <option value="">— Không giao cho ai —</option>
              {/* `users` is who can be assigned on the *report* issue, which is
                  not guaranteed to include this issue's reporter. Without this
                  the select would silently fall back to "không giao cho ai"
                  while the label above still named them. */}
              {parent.reporter && !users.some((u) => u.accountId === parent.reporter?.accountId) ? (
                <option value={parent.reporter.accountId}>
                  {parent.reporter.displayName}
                </option>
              ) : null}
              {users.map((user) => (
                <option key={user.accountId} value={user.accountId}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </div>

          <p className="rounded border border-line bg-canvas px-2.5 py-2 text-xs text-muted">
            {drafts.length > 1 ? (
              <>
                Sẽ tạo <span className="text-ink">{drafts.length} task</span>, mỗi vòng một
                task.{' '}
              </>
            ) : null}
            Task tạo ra ở trạng thái <span className="text-ink">To Do</span>. Đây là thao
            tác ghi thật lên Jira.
          </p>

          {error ? <ErrorBanner message={error} /> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || drafts.length === 0}
          >
            {busy
              ? 'Đang tạo…'
              : drafts.length > 1
                ? `Tạo ${drafts.length} task QA`
                : 'Tạo task QA'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
