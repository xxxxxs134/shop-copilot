import { Badge } from '@/components/ui/Badge';
import { statusMeta } from '@/lib/status';

export function StatusBadge({ status }: { status: string }) {
  const { label, tone } = statusMeta(status);
  return <Badge tone={tone}>{label}</Badge>;
}
