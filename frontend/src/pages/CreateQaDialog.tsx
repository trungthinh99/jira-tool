import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { IssueSummary, JiraUser, Mention } from '../api/types';
import { Button, ErrorBanner } from '../components/ui';
import { todayStamp } from '../utils';

/** `YYMMDD` -> `DD/MM/YYYY`, so the seeded stamp can be sanity-checked by eye. */
function readStamp(stamp: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return stamp;
  return `${match[3]}/${match[2]}/20${match[1]}`;
}

/** Only what the dialog shows — a story header has no IssueSummary of its own. */
export interface QaParent {
  key: string;
  summary: string;
  /** `YYMMDD` of the handover round this QA belongs to. See `qaStamp()`. */
  stamp: string;
}

interface Props {
  /** Story, improvement or bug the QA sub-task is created under. */
  parent: QaParent;
  users: JiraUser[];
  /** Seeded as the assignee — the project's BA. */
  defaultAssignee: Mention | undefined;
  onClose: () => void;
  onCreated: (issue: IssueSummary) => void;
}

export function CreateQaDialog({
  parent,
  users,
  defaultAssignee,
  onClose,
  onCreated,
}: Props) {
  // `QA_YYMMDD: Test giao diện và chức năng ` — the trailing space is where the
  // user keeps typing, so the caret lands after it. The stamp comes from the
  // handover round, not from today; see `qaStamp()`.
  const [summary, setSummary] = useState(
    `QA_${parent.stamp}: Test giao diện và chức năng `,
  );
  const [assignee, setAssignee] = useState(defaultAssignee?.accountId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const submit = async () => {
    const trimmed = summary.trim();
    if (!trimmed) {
      setError('Tiêu đề không được để trống.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { issue } = await api.createSubtask(parent.key, trimmed, assignee || undefined);
      onCreated(issue);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tạo được task QA.');
      setBusy(false);
    }
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
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Tiêu đề</label>
            <textarea
              autoFocus
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={2}
              className="w-full resize-y rounded border border-line bg-raised p-2.5 text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              Điền tiếp phần mô tả sau &ldquo;chức năng&rdquo;. Ngày{' '}
              <span className="text-ink">{readStamp(parent.stamp)}</span>
              {parent.stamp === todayStamp()
                ? ' (hôm nay — không thấy stamp nào ở sub-task)'
                : ' lấy theo stamp của task FE/BE cùng story'}
              .
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Giao cho</label>
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="h-9 w-full rounded border border-line bg-raised px-2 text-sm"
            >
              <option value="">— Không giao cho ai —</option>
              {users.map((user) => (
                <option key={user.accountId} value={user.accountId}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </div>

          <p className="rounded border border-line bg-canvas px-2.5 py-2 text-xs text-muted">
            Task tạo ra ở trạng thái <span className="text-ink">To Do</span>. Đây là thao
            tác ghi thật lên Jira.
          </p>

          {error ? <ErrorBanner message={error} /> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Đang tạo…' : 'Tạo task QA'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
