interface Props {
  label?: string;
  size?: number;
  className?: string;
}

export function LoadingSpinner({
  label = 'Loading',
  size = 10,
  className = '',
}: Props) {
  return (
    <span role="status" className={`inline-flex -translate-y-px shrink-0 items-center justify-center ${className}`}>
      <span
        aria-hidden="true"
        className="block animate-spin rounded-full border border-current border-r-transparent motion-reduce:animate-none"
        style={{ width: size, height: size }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
