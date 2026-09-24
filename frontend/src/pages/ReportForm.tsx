import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type {
  IssueSummary,
  JiraUser,
  Mention,
  PostedReport,
  ReportTarget,
  SlackPing,
} from '../api/types';
import { Badge, Button, Card, CardHeader, ErrorBanner, statusTone } from '../components/ui';
import { cn, defaultPercent, toReportDate } from '../utils';
import { MentionPicker } from './MentionPicker';

interface TaskRow {
  key: string;
  percent: number;
  included: boolean;
  /** Present for rows that came from the activity query, absent for manual ones. */
  issue?: IssueSummary;
}

interface Props {
  target: ReportTarget;
  /** Issues for this target only, already filtered by project. */
  issues: IssueSummary[];
  isoDate: string;
  loadingIssues: boolean;
  /**
   * Where this form was posted, if it was. Held by the parent because the form
   * is remounted on every tab switch — the Slack button has to survive that to
   * know which projects are already reported.
   */
  posted: PostedReport | null;
  onPosted: (result: PostedReport) => void;
  /** Null when Slack is not configured; the button is then not rendered. */
  slack: SlackButton | null;
}

/**
 * Everything the Slack button needs, owned by the page.
 *
 * The message announces the day's reporting, not one issue, so its state has
 * to outlive the tab switch that remounts this form — see CLAUDE.md §3.
 */
export interface SlackButton {
  message: string;
  ping: SlackPing | null;
  pinging: boolean;
  onSend: () => void | Promise<void>;
}

export function ReportForm({
  target,
  issues,
  isoDate,
  loadingIssues,
  posted,
  onPosted,
  slack,
}: Props) {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [nextTasks, setNextTasks] = useState('');
  const [issueNote, setIssueNote] = useState('none');
  const [preview, setPreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState('');
  const [mentions, setMentions] = useState<Mention[]>(target.mentions);
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  /**
   * Percents from the previous report, by issue key. `null` until it has been
   * fetched, so the rows are not built from a default that is about to be
   * replaced — a carried-over task would flash 70% and then jump.
   */
  const [lastPercents, setLastPercents] = useState<Record<string, number> | null>(null);

  // Rebuild the task rows whenever the day's activity changes. Manual rows are
  // deliberately dropped here: they belong to the day they were typed for.
  useEffect(() => {
    if (lastPercents === null) return;
    setRows(
      issues.map((issue) => ({
        key: issue.key,
        // A task carried over from yesterday reopens at the figure it was last
        // reported at; the status default would drag it back to 70%. Only for
        // carried-over rows: one that moved to Done today is 100%, whatever
        // yesterday said.
        percent: (issue.wip ? lastPercents[issue.key] : undefined) ?? defaultPercent(issue),
        included: true,
        issue,
      })),
    );
    setPreview(null);
  }, [issues, lastPercents]);

  // Seed "Next task" and the carried-over percents from the previous report.
  useEffect(() => {
    let cancelled = false;
    api
      .previousReport(target.id)
      .then(({ nextTasks: lines, percents }) => {
        if (cancelled) return;
        setNextTasks(lines.join('\n'));
        setLastPercents(percents);
      })
      .catch(() => {
        if (cancelled) return;
        setNextTasks(target.defaultNextTasks.join('\n'));
        // Empty rather than left null: the rows must still render.
        setLastPercents({});
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Load the people who can be mentioned on this target's report issue.
  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);
    setUsersError(null);
    api
      .users(target.id)
      .then(({ users: fetched }) => {
        if (!cancelled) setUsers(fetched);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setUsersError(
          caught instanceof Error ? caught.message : 'Không tải được danh sách người dùng.',
        );
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const payload = useMemo(
    () => ({
      dateLabel: toReportDate(isoDate),
      todayTasks: rows
        .filter((row) => row.included)
        .map((row) => ({
          key: row.key,
          percent: row.percent,
          // Manual rows have no issue behind them, so they link by key.
          ...(row.issue ? { summary: row.issue.summary } : {}),
        })),
      nextTasks: nextTasks
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      issue: issueNote.trim() || 'none',
      mentions,
    }),
    [isoDate, rows, nextTasks, issueNote, mentions],
  );

  const canSubmit = payload.todayTasks.length > 0 && payload.nextTasks.length > 0;

  const update = useCallback((key: string, patch: Partial<TaskRow>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }, []);

  const addManual = () => {
    const key = manualKey.trim().toUpperCase();
    if (!key) return;
    if (rows.some((row) => row.key === key)) {
      setError(`${key} đã có trong danh sách.`);
      return;
    }
    setRows((current) => [...current, { key, percent: 100, included: true }]);
    setManualKey('');
    setError(null);
  };

  const runPreview = async () => {
    setError(null);
    try {
      const { text } = await api.preview(target.id, payload);
      setPreview(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không dựng được bản xem trước.');
    }
  };

  const submit = async () => {
    setPosting(true);
    setError(null);
    try {
      onPosted(await api.postReport(target.id, payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không đăng được báo cáo.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            title={`Today task · ${payload.todayTasks.length} task`}
            subtitle="Bỏ tick để loại khỏi báo cáo. Sửa % trực tiếp nếu cần."
          />

          {loadingIssues ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Đang thống kê…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Không có task nào đổi trạng thái trong ngày. Thêm thủ công ở dưới.
            </p>
          ) : (
            <ul className="scrollbar-thin max-h-[420px] overflow-y-auto">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className={cn(
                    'flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0',
                    !row.included && 'opacity-45',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={(event) => update(row.key, { included: event.target.checked })}
                    className="h-4 w-4 shrink-0 accent-brand"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`${target.reportIssueUrl.split('/browse/')[0]}/browse/${row.key}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs font-semibold text-brand hover:underline"
                      >
                        {row.key}
                      </a>
                      {row.issue ? (
                        <Badge tone={statusTone(row.issue.statusCategory)}>
                          {row.issue.status}
                        </Badge>
                      ) : (
                        <Badge tone="warning">thủ công</Badge>
                      )}
                      {/* Says why the row is here: it did not move today, it is
                          simply still open. The percent is yesterday's. */}
                      {row.issue?.wip ? (
                        <Badge tone="neutral" title="Chưa đổi trạng thái hôm nay — % lấy từ báo cáo gần nhất">
                          đang làm
                        </Badge>
                      ) : null}
                    </div>
                    {row.issue ? (
                      <p className="mt-0.5 truncate text-xs text-muted" title={row.issue.summary}>
                        {row.issue.summary}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={row.percent}
                      onChange={(event) =>
                        update(row.key, { percent: Number(event.target.value) })
                      }
                      className="h-7 w-16 rounded border border-line bg-raised px-2 text-right text-xs"
                    />
                    <span className="text-xs text-muted">%</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Xoá dòng"
                      onClick={() =>
                        setRows((current) => current.filter((item) => item.key !== row.key))
                      }
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
            <input
              value={manualKey}
              onChange={(event) => setManualKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addManual();
              }}
              placeholder={`Thêm thủ công, vd ${target.projectKey}-123`}
              className="h-8 flex-1 rounded border border-line bg-raised px-2.5 text-xs placeholder:text-muted"
            />
            <Button size="sm" onClick={addManual}>
              Thêm
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Next task"
            subtitle="Mỗi dòng là một gạch đầu dòng. Đã điền sẵn từ báo cáo gần nhất."
          />
          <div className="p-4">
            <textarea
              value={nextTasks}
              onChange={(event) => setNextTasks(event.target.value)}
              rows={4}
              className="w-full resize-y rounded border border-line bg-raised p-2.5 text-sm"
            />
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Issue" subtitle="Để 'none' nếu không có vướng mắc." />
            <div className="p-4">
              <input
                value={issueNote}
                onChange={(event) => setIssueNote(event.target.value)}
                className="w-full rounded border border-line bg-raised p-2.5 text-sm"
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Mention"
              subtitle="Người được tag ở cuối báo cáo."
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  title="Về mặc định của dự án"
                  onClick={() => setMentions(target.mentions)}
                >
                  Mặc định
                </Button>
              }
            />
            <MentionPicker
              value={mentions}
              onChange={setMentions}
              users={users}
              loading={usersLoading}
              error={usersError}
            />
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Xem trước"
            subtitle={`Sẽ đăng vào ${target.reportIssueKey}`}
            actions={
              <Button size="sm" onClick={() => void runPreview()}>
                Dựng lại
              </Button>
            }
          />
          <div className="p-4">
            <pre className="scrollbar-thin max-h-[380px] overflow-auto whitespace-pre-wrap rounded border border-line bg-canvas p-3 font-mono text-xs leading-relaxed">
              {preview ?? 'Bấm "Dựng lại" để xem nội dung sẽ đăng.'}
            </pre>
            <p className="mt-2 text-xs text-muted">
              Mention:{' '}
              {mentions.length > 0
                ? mentions.map((mention) => `@${mention.name}`).join(' ')
                : 'không tag ai'}
            </p>
          </div>
        </Card>

        {error ? <ErrorBanner message={error} /> : null}

        {posted ? (
          <div className="rounded border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
            <p className="font-medium text-success">Đã đăng báo cáo.</p>
            <a
              href={posted.url}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Mở comment trên Jira →
            </a>
          </div>
        ) : null}

        <Button
          variant="primary"
          className="w-full"
          disabled={!canSubmit || posting}
          onClick={() => void submit()}
        >
          {posting
            ? 'Đang đăng…'
            : posted
              ? `Đăng lại vào ${target.reportIssueKey}`
              : `Đăng báo cáo vào ${target.reportIssueKey}`}
        </Button>

        {!canSubmit ? (
          <p className="text-center text-xs text-muted">
            Cần ít nhất 1 task và 1 dòng Next task.
          </p>
        ) : null}

        {slack ? (
          <>
            <Button
              className="w-full"
              variant="danger"
              disabled={slack.pinging}
              onClick={() => void slack.onSend()}
              title={slack.message}
            >
              {slack.pinging ? 'Đang gửi…' : 'Nhắn tin Slack'}
            </Button>

            {/* Only spoken up about once it has happened — the button says
                nothing about whether the message went out, and a second click
                would ping the channel twice. */}
            {slack.ping?.sent ? (
              <p className="text-center text-xs text-success">✓ Đã nhắn Slack.</p>
            ) : null}
            {slack.ping?.error ? (
              <p className="text-center text-xs text-danger">{slack.ping.error}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
