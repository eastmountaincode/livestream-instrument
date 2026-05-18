import type { LiveSource } from '../services/streams';

interface Props {
  activeIds: Set<string>;
  sources: LiveSource[];
}

export function SourceBackdrop({ activeIds, sources }: Props) {
  const activeSources = sources.filter(
    s => activeIds.has(s.id) && s.imageUrl
  );

  if (activeSources.length === 0) return null;

  const opacity = 1 / activeSources.length;

  return (
    <div className="pointer-events-none fixed inset-0 -z-1">
      {activeSources.map(source => (
        <div
          key={source.id}
          className="absolute inset-0 bg-cover bg-center grayscale transition-opacity duration-2000 ease-in-out"
          style={{
            backgroundImage: `url(${source.imageUrl})`,
            opacity: opacity * 0.22,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-[rgba(242,240,232,0.86)]" />
    </div>
  );
}
