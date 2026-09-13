import { ChevronLeft, ChevronRight } from 'lucide-react';
import IconButton from './IconButton';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <p>
        <span className="font-medium text-slate-800">
          {from}–{to}
        </span>{' '}
        z {total}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <IconButton
            icon={ChevronLeft}
            label="Poprzednia strona"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          />
          <span className="tabular-nums">
            {page} / {pageCount}
          </span>
          <IconButton
            icon={ChevronRight}
            label="Następna strona"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          />
        </div>
      )}
    </div>
  );
}
