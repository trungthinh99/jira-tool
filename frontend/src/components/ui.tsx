import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        // On dark, the accent colors are light — so filled buttons take dark
        // text, not white.
        variant === 'primary' && 'bg-brand text-brand-contrast hover:bg-brand-hover',
        variant === 'secondary' && 'border border-line bg-raised text-ink hover:bg-brand-soft',
        variant === 'ghost' && 'text-muted hover:bg-raised hover:text-ink',
        variant === 'danger' && 'bg-danger text-brand-contrast hover:opacity-90',
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const TONE_CLASS = {
  neutral: 'bg-raised text-muted border-line',
  brand: 'bg-brand-soft text-brand border-brand/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Map a Jira status category onto a badge tone. */
export function statusTone(category: string): keyof typeof TONE_CLASS {
  if (category === 'done') return 'success';
  if (category === 'indeterminate') return 'brand';
  return 'neutral';
}

export function EmptyState({ message }: { message: string }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{message}</p>;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-danger/30 bg-danger/10 px-3 py-2">
      <p className="text-sm text-danger">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

export function Spinner({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </p>
  );
}
