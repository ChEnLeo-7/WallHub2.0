import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useText } from '@/lib/text';

export function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (page: number) => void }) {
  const text = useText();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(String(page));
  React.useEffect(() => setDraft(String(page)), [page]);
  if (totalPages <= 1) return null;
  const commit = () => {
    const next = Math.max(1, Math.min(totalPages, Number.parseInt(draft, 10) || page));
    setEditing(false);
    setPage(next);
  };
  const pageRadius = typeof window !== 'undefined' && window.innerWidth < 420 ? 1 : 2;
  const pages = new Set<number>([1, totalPages, page]);
  for (let offset = 1; offset <= pageRadius; offset += 1) {
    pages.add(page - offset);
    pages.add(page + offset);
  }
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const nodes: React.ReactNode[] = [];
  sorted.forEach((p, index) => {
    if (index > 0 && p - sorted[index - 1] > 1) nodes.push(<span key={`gap-${p}`} className="px-1 text-muted-foreground sm:px-2">...</span>);
    if (p === page && editing) {
      nodes.push(
        <Input
          key={p}
          className="h-8 w-12 text-center sm:h-9 sm:w-16"
          value={draft}
          autoFocus
          inputMode="numeric"
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setEditing(false);
          }}
        />,
      );
    } else {
      nodes.push(
        <Button key={p} className="h-8 min-w-8 px-2 sm:h-9 sm:min-w-9 sm:px-3" variant={p === page ? 'default' : 'outline'} size="sm" onClick={() => (p === page ? setEditing(true) : setPage(p))}>
          {p}
        </Button>,
      );
    }
  });
  return (
    <div className="mt-6 flex justify-center sm:mt-8">
      <div className="flex max-w-full flex-nowrap items-center justify-center gap-1 overflow-x-auto px-1 py-1 scrollbar-thin sm:gap-2">
        <Button className="h-8 px-2 sm:h-9 sm:px-3" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={text.prevPage}>
          <ChevronLeft className="h-4 w-4 sm:hidden" />
          <span className="hidden sm:inline">{text.prevPage}</span>
        </Button>
        {nodes}
        <Button className="h-8 px-2 sm:h-9 sm:px-3" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label={text.nextPage}>
          <span className="hidden sm:inline">{text.nextPage}</span>
          <ChevronRight className="h-4 w-4 sm:hidden" />
        </Button>
      </div>
    </div>
  );
}
