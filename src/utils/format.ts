export function formatLocalTime(date: Date, timeZone?: string): string {
  if (!timeZone) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return '';
  }
}

export function formatCategory(category?: string): string {
  if (!category || category === 'uncategorized') return '';

  return category
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
