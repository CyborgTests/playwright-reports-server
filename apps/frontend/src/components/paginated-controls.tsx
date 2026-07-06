import {
  Pagination,
  PaginationContent,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

interface PaginatedControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

// Number of numbered page links to show in the sliding window.
const WINDOW = 5;

export default function PaginatedControls({
  page,
  totalPages,
  onPageChange,
  className,
}: Readonly<PaginatedControlsProps>) {
  if (totalPages <= 1) return null;

  const atFirst = page === 1;
  const atLast = page === totalPages;
  const edgeClass = (disabled: boolean) =>
    disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer';

  return (
    <Pagination className={cn(className)}>
      <PaginationContent>
        <PaginationItem>
          <PaginationFirst
            onClick={() => !atFirst && onPageChange(1)}
            className={edgeClass(atFirst)}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationPrevious
            onClick={() => page > 1 && onPageChange(page - 1)}
            className={edgeClass(atFirst)}
          />
        </PaginationItem>
        {Array.from({ length: Math.min(totalPages, WINDOW) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= WINDOW) {
            pageNum = i + 1;
          } else if (page <= 3) {
            pageNum = i + 1;
          } else if (page >= totalPages - 2) {
            pageNum = totalPages - 4 + i;
          } else {
            pageNum = page - 2 + i;
          }

          return (
            <PaginationItem key={pageNum}>
              <PaginationLink
                onClick={() => onPageChange(pageNum)}
                isActive={page === pageNum}
                className="cursor-pointer"
              >
                {pageNum}
              </PaginationLink>
            </PaginationItem>
          );
        })}
        <PaginationItem>
          <PaginationNext
            onClick={() => page < totalPages && onPageChange(page + 1)}
            className={edgeClass(atLast)}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLast
            onClick={() => !atLast && onPageChange(totalPages)}
            className={edgeClass(atLast)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
