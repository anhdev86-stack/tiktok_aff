/**
 * Start / Stop buttons for a single crawler group.
 * Disabled based on group enabled flag + live status.
 */
import { Loader2, PlayCircle, StopCircle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crawlerApi } from '@/lib/api-endpoints'
import { handleServerError } from '@/lib/handle-server-error'
import type { CrawlerGroupStatus } from '@/lib/api-types'
import { Button } from '@/components/ui/button'

interface Props {
  group: CrawlerGroupStatus
}

export function CrawlerControls({ group }: Props) {
  const qc = useQueryClient()

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['crawler-all-status'] })
  }

  const startMutation = useMutation({
    mutationFn: () => crawlerApi.startGroup(group._id),
    onSuccess: () => {
      toast.success(`Đã bắt đầu nhóm "${group.name}"`)
      invalidate()
    },
    onError: handleServerError,
  })

  const stopMutation = useMutation({
    mutationFn: () => crawlerApi.stopGroup(group._id),
    onSuccess: () => {
      toast.success(`Nhóm "${group.name}" đang dừng…`)
      invalidate()
    },
    onError: handleServerError,
  })

  const isRunning =
    group.enabled ||
    group.status === 'running' ||
    group.status === 'sleeping' ||
    group.status === 'stopping'

  const busy = startMutation.isPending || stopMutation.isPending

  return (
    <div className='flex flex-wrap gap-2'>
      <Button
        size='sm'
        onClick={() => startMutation.mutate()}
        disabled={isRunning || busy}
      >
        {startMutation.isPending ? (
          <Loader2 className='me-1.5 size-3.5 animate-spin' />
        ) : (
          <PlayCircle className='me-1.5 size-3.5' />
        )}
        Bắt đầu
      </Button>

      <Button
        size='sm'
        variant='destructive'
        onClick={() => stopMutation.mutate()}
        disabled={!isRunning || busy}
      >
        {stopMutation.isPending ? (
          <Loader2 className='me-1.5 size-3.5 animate-spin' />
        ) : (
          <StopCircle className='me-1.5 size-3.5' />
        )}
        Dừng lại
      </Button>
    </div>
  )
}
