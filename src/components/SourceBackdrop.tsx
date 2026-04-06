import { LIVE_SOURCES } from '../services/streams';

interface Props {
  activeIds: Set<string>;
}

export function SourceBackdrop({ activeIds }: Props) {
  const activeSources = LIVE_SOURCES.filter(
    s => activeIds.has(s.id) && s.imageUrl
  );

  if (activeSources.length === 0) return null;

  const opacity = 1 / activeSources.length;

  return (
    <div className="fixed inset-0 -z-1 pointer-events-none">
      {activeSources.map(source => (
        <div
          key={source.id}
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-2000 ease-in-out"
          style={{
            backgroundImage: `url(${source.imageUrl})`,
            opacity,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-[rgba(10,10,10,0.7)]" />
    </div>
  );
}
