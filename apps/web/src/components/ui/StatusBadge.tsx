import type { StatusMeta } from '../../lib/status';

/** Status z polską etykietą i ikoną — `meta` pochodzi z map w lib/status.ts. */
export default function StatusBadge({ meta }: { meta: StatusMeta }) {
  const Icon = meta.icon;
  return (
    <span className={`badge items-center gap-1 whitespace-nowrap ${meta.className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
