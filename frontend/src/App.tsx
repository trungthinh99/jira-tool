import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { ReportTarget } from './api/types';
import { Card, ErrorBanner, Spinner } from './components/ui';
import { InboxPage } from './pages/InboxPage';
import { ReportPage } from './pages/ReportPage';
import { cn } from './utils';

type MenuKey = 'inbox' | 'report';

const MENU: { key: MenuKey; label: string; icon: string; hint: string }[] = [
  { key: 'inbox', label: 'Thông báo', icon: '📥', hint: 'Task mới được phân' },
  { key: 'report', label: 'Báo cáo', icon: '📝', hint: 'Báo cáo hàng ngày' },
];

export function App() {
  const [menu, setMenu] = useState<MenuKey>('inbox');
  const [targets, setTargets] = useState<ReportTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .targets()
      .then(setTargets)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? `${caught.message} — backend đã chạy chưa? (cổng 4180)`
            : 'Không kết nối được backend.',
        ),
      );
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-4 py-4">
          <h1 className="text-sm font-bold">Jira Report Tool</h1>
          <p className="mt-0.5 text-xs text-muted">jakenm.atlassian.net</p>
        </div>

        <nav className="flex-1 p-2">
          {MENU.map((item) => (
            <button
              key={item.key}
              onClick={() => setMenu(item.key)}
              className={cn(
                'mb-1 flex w-full items-start gap-2.5 rounded px-3 py-2 text-left transition',
                menu === item.key
                  ? 'bg-brand-soft text-brand'
                  : 'text-muted hover:bg-canvas hover:text-ink',
              )}
            >
              <span className="text-base leading-5">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs opacity-80">{item.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        {targets ? (
          <div className="border-t border-line px-4 py-3 text-xs text-muted">
            <p className="mb-1 font-medium">Đích báo cáo</p>
            {targets.map((target) => (
              <a
                key={target.id}
                href={target.reportIssueUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate hover:text-brand hover:underline"
              >
                {target.label} → {target.reportIssueKey}
              </a>
            ))}
          </div>
        ) : null}
      </aside>

      <main className="min-w-0 flex-1 p-5">
        <div className="mx-auto max-w-6xl">
          {error ? <ErrorBanner message={error} /> : null}

          {!targets && !error ? (
            <Card>
              <Spinner label="Đang kết nối backend…" />
            </Card>
          ) : null}

          {targets ? (
            menu === 'inbox' ? (
              <InboxPage />
            ) : (
              <ReportPage targets={targets} />
            )
          ) : null}
        </div>
      </main>
    </div>
  );
}
