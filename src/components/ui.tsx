import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

type ClassValue = string | false | null | undefined;
type BadgeTone = 'default' | 'active' | 'muted' | 'warning' | 'error';
type BadgeSize = 'xs' | 'sm';

export function cx(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(' ');
}

interface PanelProps {
  title: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  meta?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, label, open, onToggle, children, meta, className, bodyClassName }: PanelProps) {
  return (
    <section className={cx('w-full border border-ink bg-paper', className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b border-ink bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase text-copy hover:bg-ink hover:text-paper"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="min-w-8 font-mono text-[10px] font-semibold">{label}</span>
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] font-semibold">
          {meta}
          <span>{open ? 'Close' : 'Open'}</span>
        </span>
      </button>
      {open && <div className={cx('p-3', bodyClassName)}>{children}</div>}
    </section>
  );
}

export function UiButton({ className, type, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type ?? 'button'}
      className={cx(
        'border border-ink bg-paper px-3.5 py-[5px] font-mono text-[11px] font-semibold uppercase text-copy hover:bg-ink hover:text-paper disabled:opacity-30',
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = 'default',
  size = 'xs',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; size?: BadgeSize }) {
  const toneClass: Record<BadgeTone, string> = {
    default: 'bg-paper text-copy',
    active: 'bg-ink text-paper',
    muted: 'bg-accent text-copy',
    warning: 'bg-warning text-copy',
    error: 'bg-error text-copy',
  };
  const sizeClass: Record<BadgeSize, string> = {
    xs: 'text-[10px]',
    sm: 'text-[11px]',
  };

  return (
    <span
      className={cx(
        'border border-ink px-2 py-0.5 font-semibold uppercase',
        toneClass[tone],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeading({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx('m-0 text-[11px] font-semibold uppercase text-copy', className)} {...props} />;
}

export function MinorHeading({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h4 className={cx('mb-1.5 text-[11px] font-semibold uppercase text-muted', className)} {...props} />;
}

export function UiSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx('border border-ink bg-paper px-1.5 py-[3px] font-mono text-[11px] font-medium text-copy', className)}
      {...props}
    />
  );
}

export function UiTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx('mb-1 w-full resize-y border border-ink bg-paper p-1.5 font-mono text-[10px] text-copy', className)}
      {...props}
    />
  );
}
