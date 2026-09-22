import { useEffect, useMemo, useRef, useState } from 'react';
import type { JiraUser, Mention } from '../api/types';
import { Badge, Button } from '../components/ui';
import { cn } from '../utils';

interface Props {
  /** Currently selected mentions, in the order they will be rendered. */
  value: Mention[];
  onChange: (mentions: Mention[]) => void;
  /** Everyone who can be mentioned; empty while still loading. */
  users: JiraUser[];
  loading: boolean;
  error: string | null;
}

export function MentionPicker({ value, onChange, users, loading, error }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a dropdown left open covers the
  // preview pane next to it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedIds = useMemo(
    () => new Set(value.map((mention) => mention.accountId)),
    [value],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter(
      (user) =>
        !selectedIds.has(user.accountId) &&
        (!needle || user.displayName.toLowerCase().includes(needle)),
    );
  }, [users, selectedIds, query]);

  const add = (user: JiraUser) => {
    onChange([...value, { accountId: user.accountId, name: user.displayName }]);
    setQuery('');
  };

  const remove = (accountId: string) => {
    onChange(value.filter((mention) => mention.accountId !== accountId));
  };

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((mention) => (
          <span
            key={mention.accountId}
            className="inline-flex items-center gap-1 rounded border border-brand/30 bg-brand-soft py-0.5 pl-2 pr-1 text-xs font-medium text-brand"
          >
            @{mention.name}
            <button
              onClick={() => remove(mention.accountId)}
              title={`Bỏ @${mention.name}`}
              className="rounded px-0.5 leading-none text-brand/70 hover:text-brand"
            >
              ✕
            </button>
          </span>
        ))}

        {value.length === 0 ? (
          <span className="text-xs text-muted">Chưa chọn ai — báo cáo sẽ không tag người nào.</span>
        ) : null}

        <div className="relative" ref={boxRef}>
          <Button size="sm" onClick={() => setOpen((current) => !current)}>
            + Thêm
          </Button>

          {open ? (
            <div className="absolute right-0 z-20 mt-1 w-60 rounded border border-line bg-surface shadow-lg shadow-black/40">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tên…"
                className="w-full rounded-t border-b border-line bg-raised px-2.5 py-2 text-xs placeholder:text-muted"
              />

              <ul className="scrollbar-thin max-h-56 overflow-y-auto py-1">
                {loading ? (
                  <li className="px-2.5 py-2 text-xs text-muted">Đang tải danh sách…</li>
                ) : error ? (
                  <li className="px-2.5 py-2 text-xs text-danger">{error}</li>
                ) : matches.length === 0 ? (
                  <li className="px-2.5 py-2 text-xs text-muted">
                    {query.trim() ? 'Không tìm thấy ai.' : 'Đã chọn hết rồi.'}
                  </li>
                ) : (
                  matches.map((user) => (
                    <li key={user.accountId}>
                      <button
                        onClick={() => add(user)}
                        className={cn(
                          'w-full px-2.5 py-1.5 text-left text-xs transition',
                          'hover:bg-raised hover:text-brand',
                        )}
                      >
                        @{user.displayName}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {error && !open ? (
        <p className="mt-2 text-xs text-danger">{error}</p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Điền sẵn theo dự án. Người được tag sẽ nhận thông báo từ Jira.{' '}
          <Badge>{value.length}</Badge>
        </p>
      )}
    </div>
  );
}
