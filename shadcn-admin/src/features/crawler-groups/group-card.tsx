/**
 * Card hiển thị thông tin một CrawlerGroup với actions: Sửa / Accounts / Xoá.
 */
import { Pencil, Trash2, Users } from 'lucide-react'
import type { CrawlerGroup } from '@/lib/api-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const STATUS_LABELS: Record<CrawlerGroup['status'], string> = {
  idle: 'Idle',
  running: 'Running',
  sleeping: 'Sleeping',
  stopping: 'Stopping',
}

const STATUS_VARIANTS: Record<
  CrawlerGroup['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  idle: 'secondary',
  running: 'default',
  sleeping: 'outline',
  stopping: 'destructive',
}

interface Props {
  group: CrawlerGroup
  onEdit: (group: CrawlerGroup) => void
  onManageAccounts: (group: CrawlerGroup) => void
  onDelete: (group: CrawlerGroup) => void
}

export function GroupCard({ group, onEdit, onManageAccounts, onDelete }: Props) {
  const ssidDisplay = group.spreadsheetId
    ? group.spreadsheetId.length > 20
      ? `${group.spreadsheetId.slice(0, 20)}…`
      : group.spreadsheetId
    : 'Chưa cấu hình'

  return (
    <Card className='flex flex-col'>
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between gap-2'>
          <h3 className='truncate text-base font-semibold leading-tight'>
            {group.name}
          </h3>
          <div className='flex shrink-0 gap-1'>
            <Badge
              variant={group.enabled ? 'default' : 'secondary'}
              className='text-xs'
            >
              {group.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Badge
              variant={STATUS_VARIANTS[group.status]}
              className='text-xs'
            >
              {STATUS_LABELS[group.status]}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className='flex flex-1 flex-col justify-between gap-3 pt-0'>
        <div className='space-y-1 text-sm text-muted-foreground'>
          <p className='flex items-center gap-1'>
            <span className='font-medium text-foreground'>Spreadsheet:</span>
            <span
              className='truncate font-mono text-xs'
              title={group.spreadsheetId || undefined}
            >
              {ssidDisplay}
            </span>
          </p>
          <p>
            <span className='font-medium text-foreground'>Loop count:</span>{' '}
            {group.loopCount}
          </p>
          {group.lastError && (
            <p className='truncate text-xs text-destructive' title={group.lastError}>
              Lỗi: {group.lastError}
            </p>
          )}
        </div>

        <div className='flex gap-1.5'>
          <Button
            size='sm'
            variant='outline'
            className='flex-1'
            onClick={() => onEdit(group)}
          >
            <Pencil className='me-1.5 size-3.5' />
            Sửa
          </Button>
          <Button
            size='sm'
            variant='outline'
            className='flex-1'
            onClick={() => onManageAccounts(group)}
          >
            <Users className='me-1.5 size-3.5' />
            Accounts
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='shrink-0 text-destructive hover:text-destructive'
            onClick={() => onDelete(group)}
            title='Xoá nhóm'
          >
            <Trash2 className='size-4' />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
