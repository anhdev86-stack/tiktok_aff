/**
 * Status card for a single crawler group — header badge, metrics grid,
 * last-error alert, and inline Start/Stop controls.
 */
import { AlertCircle, Settings } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { CrawlerGroupStatus } from '@/lib/api-types'
import { friendlyCookieError } from '@/lib/cookie-error-message'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CrawlerControls } from './crawler-controls'

const STATUS_VARIANT: Record<
  CrawlerGroupStatus['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  running: 'default',
  sleeping: 'outline',
  stopping: 'destructive',
  idle: 'secondary',
}

const STATUS_LABEL: Record<CrawlerGroupStatus['status'], string> = {
  running: 'Đang chạy',
  sleeping: 'Đang nghỉ',
  stopping: 'Đang dừng',
  idle: 'Rảnh',
}

/** Format UTC ISO string as relative Vietnamese time (e.g. "3 phút trước"). */
function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s trước`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} phút trước`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} giờ trước`
  return `${Math.floor(diffHr / 24)} ngày trước`
}

/** Truncate a MongoDB ObjectId-style string for compact display. */
function truncateId(id: string | null): string {
  if (!id) return '—'
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

interface Props {
  group: CrawlerGroupStatus
}

export function CrawlerStatusCard({ group }: Props) {
  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
            {group.name}
            <Badge variant={STATUS_VARIANT[group.status]}>
              {STATUS_LABEL[group.status]}
            </Badge>
          </CardTitle>
          <Button
            size='icon'
            variant='ghost'
            className='size-7 shrink-0 text-muted-foreground'
            asChild
            title='Cấu hình nhóm'
          >
            <Link to='/crawler-groups'>
              <Settings className='size-4' />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className='space-y-3'>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4'>
          <div>
            <dt className='text-xs uppercase text-muted-foreground'>
              Account hiện tại
            </dt>
            <dd className='truncate font-medium font-mono text-xs'>
              {truncateId(group.currentAccountId)}
            </dd>
          </div>
          <div>
            <dt className='text-xs uppercase text-muted-foreground'>
              Số vòng
            </dt>
            <dd className='font-medium'>{group.loopCount}</dd>
          </div>
          <div>
            <dt className='text-xs uppercase text-muted-foreground'>
              Bắt đầu
            </dt>
            <dd className='font-medium'>
              {relativeTime(group.lastLoopStartedAt)}
            </dd>
          </div>
          <div>
            <dt className='text-xs uppercase text-muted-foreground'>
              Hoàn thành
            </dt>
            <dd className='font-medium'>
              {relativeTime(group.lastLoopFinishedAt)}
            </dd>
          </div>
        </dl>

        {group.lastError && (
          <Alert variant={group.status === 'idle' || group.status === 'stopping' ? 'destructive' : 'default'}>
            <AlertCircle className='size-4' />
            <AlertDescription className='text-xs'>
              {friendlyCookieError(group.lastError)}
            </AlertDescription>
          </Alert>
        )}

        <div className='pt-1'>
          <CrawlerControls group={group} />
        </div>
      </CardContent>
    </Card>
  )
}
