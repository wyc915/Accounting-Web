import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="-mb-3 -ml-1 inline-flex items-center gap-0.5 text-sm font-medium text-muted hover:text-fg">
      <ChevronLeft className="size-4" /> {label}
    </Link>
  );
}
