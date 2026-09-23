import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type {
  IssueSummary,
  PostedReport,
  ReportTarget,
  SlackConfig,
  SlackPing,
} from '../api/types';
import { Badge, Button, Card, CardHeader, ErrorBanner, Spinner } from '../components/ui';
import { cn, toIsoDate } from '../utils';
import { ReportForm } from './ReportForm';

export function ReportPage({ targets }: { targets: ReportTarget[] }) {
  const [isoDate, setIsoDate] = useState(() => toIsoDate(new Date()));
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(targets[0]?.id ?? '');

  /**
   * Reports posted today, by target id.
   *
   * Lives here rather than in `ReportForm` because the form is remounted on
   * every tab switch: the Slack button needs to know that HWE is already
   * reported while TMS is on screen.
   */
  const [postedByTarget, setPostedByTarget] = useState<Map<string, PostedReport>>(new Map());
  const [slack, setSlack] = useState<SlackConfig | null>(null);
  const [slackPing, setSlackPing] = useState<SlackPing | null>(null);
  const [pinging, setPinging] = useState(false);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const { issues: fetched } = await api.activity(date);
      setIssues(fetched);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thống kê được.');
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(isoDate);
  }, [isoDate, load]);

  // A new day is a new round of reporting — nothing posted, nothing announced.
  useEffect(() => {
    setPostedByTarget(new Map());
    setSlackPing(null);
  }, [isoDate]);

  // Slack is optional; without it configured the button never appears.
  useEffect(() => {
    let cancelled = false;
    api
      .slackConfig()
      .then((config) => {
        if (!cancelled) setSlack(config);
      })
      .catch(() => {
        if (!cancelled) setSlack({ enabled: false, message: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendSlack = async () => {
    setPinging(true);
    try {
      const { slack: result } = await api.pingSlack();
      setSlackPing(result);
    } catch (caught) {
      setSlackPing({
        sent: false,
        skipped: false,
        error: caught instanceof Error ? caught.message : 'Không gửi được Slack.',
      });
    } finally {
      setPinging(false);
    }
  };

  const byTarget = useMemo(() => {
    const map = new Map<string, IssueSummary[]>();
    for (const target of targets) {
      map.set(
        target.id,
        issues.filter((issue) => issue.projectKey === target.projectKey),
      );
    }
    return map;
  }, [issues, targets]);

  const active = targets.find((target) => target.id === activeId) ?? targets[0];

  // Issues from a project no report covers would otherwise vanish silently.
  const uncovered = useMemo(() => {
    const covered = new Set(targets.map((target) => target.projectKey));
    return issues.filter((issue) => !covered.has(issue.projectKey));
  }, [issues, targets]);

  const shiftDay = (days: number) => {
    const date = new Date(`${isoDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    setIsoDate(toIsoDate(date));
  };

  if (!active) return <ErrorBanner message="Chưa cấu hình report target nào." />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Báo cáo hàng ngày"
          subtitle="Thống kê các task đã đổi trạng thái trong ngày, theo từng dự án."
          actions={
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => shiftDay(-1)} title="Ngày trước">
                ‹
              </Button>
              <input
                type="date"
                value={isoDate}
                onChange={(event) => setIsoDate(event.target.value)}
                className="h-7 rounded border border-line bg-raised px-2 text-xs [color-scheme:dark]"
              />
              <Button size="sm" variant="ghost" onClick={() => shiftDay(1)} title="Ngày sau">
                ›
              </Button>
              <Button size="sm" onClick={() => setIsoDate(toIsoDate(new Date()))}>
                Hôm nay
              </Button>
              <Button size="sm" onClick={() => void load(isoDate)} disabled={loading}>
                Làm mới
              </Button>
            </div>
          }
        />

        <nav className="flex items-center gap-1 px-4 py-2">
          {targets.map((target) => {
            const count = byTarget.get(target.id)?.length ?? 0;
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
                <Badge tone={target.id === active.id ? 'brand' : 'neutral'}>{count}</Badge>
                {postedByTarget.has(target.id) ? (
                  <span className="text-success" title="Đã đăng báo cáo">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-muted">
            → {active.reportIssueKey}
          </span>
        </nav>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void load(isoDate)} /> : null}

      {uncovered.length > 0 ? (
        <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {uncovered.length} task thuộc dự án chưa cấu hình báo cáo (
          {[...new Set(uncovered.map((issue) => issue.projectKey))].join(', ')}) — không nằm
          trong tab nào.
        </div>
      ) : null}

      {loading && issues.length === 0 ? (
        <Card>
          <Spinner label="Đang thống kê task trong ngày…" />
        </Card>
      ) : (
        <ReportForm
          key={`${active.id}-${isoDate}`}
          target={active}
          issues={byTarget.get(active.id) ?? []}
          isoDate={isoDate}
          loadingIssues={loading}
          posted={postedByTarget.get(active.id) ?? null}
          onPosted={(result) =>
            setPostedByTarget((current) => new Map(current).set(active.id, result))
          }
          slack={
            // One message for the whole day, not one per project — so the
            // button lives under "Đăng báo cáo" but its state belongs to the
            // page, which survives the tab switch that remounts this form.
            slack?.enabled
              ? { message: slack.message, ping: slackPing, pinging, onSend: sendSlack }
              : null
          }
        />
      )}

    </div>
  );
}
