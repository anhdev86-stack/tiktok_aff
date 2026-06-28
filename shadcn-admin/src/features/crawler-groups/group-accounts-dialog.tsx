/**
 * Dialog assign / remove TikTok accounts cho một CrawlerGroup.
 * - Hiển thị toàn bộ accounts với checkbox.
 * - Checked = account thuộc nhóm này.
 * - Save → PATCH từng account thay đổi với groupId hoặc null.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { tiktokAccountApi } from '@/lib/api-endpoints'
import type { CrawlerGroup, TiktokAccount } from '@/lib/api-types'
import { handleServerError } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  group: CrawlerGroup
  onSuccess: () => void
}

export function GroupAccountsDialog({ open, onOpenChange, group, onSuccess }: Props) {
  const qc = useQueryClient()

  const { data: allAccounts = [], isLoading } = useQuery({
    queryKey: ['tiktok-accounts'],
    queryFn: () => tiktokAccountApi.list(),
    enabled: open,
  })

  const [checked, setChecked] = useState<Set<string>>(new Set())
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      setChecked(new Set())
      return
    }
    if (!initialized.current && !isLoading) {
      initialized.current = true
      const inGroup = allAccounts.filter((a) => a.groupId === group._id)
      setChecked(new Set(inGroup.map((a) => a._id)))
    }
  }, [open, isLoading, allAccounts, group._id])

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const toAdd = allAccounts.filter(
        (a) => checked.has(a._id) && a.groupId !== group._id,
      )
      const toRemove = allAccounts.filter(
        (a) => !checked.has(a._id) && a.groupId === group._id,
      )
      await Promise.all([
        ...toAdd.map((a) => tiktokAccountApi.update(a._id, { groupId: group._id })),
        ...toRemove.map((a) => tiktokAccountApi.update(a._id, { groupId: null })),
      ])
    },
    onSuccess: () => {
      toast.success('Đã cập nhật accounts của nhóm')
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] })
      qc.invalidateQueries({ queryKey: ['crawler-groups'] })
      onOpenChange(false)
      onSuccess()
    },
    onError: handleServerError,
  })

  const checkedCount = checked.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Users className='size-4' />
            Accounts — {group.name}
          </DialogTitle>
          <DialogDescription>
            Tick để assign account vào nhóm này. Untick để bỏ ra.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='size-5 animate-spin text-muted-foreground' />
          </div>
        ) : allAccounts.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            Chưa có TikTok Account nào.
          </p>
        ) : (
          <ScrollArea className='max-h-72'>
            <AccountCheckboxList
              accounts={allAccounts}
              checked={checked}
              currentGroupId={group._id}
              onToggle={toggle}
            />
          </ScrollArea>
        )}

        <DialogFooter className='flex items-center justify-between'>
          <span className='text-xs text-muted-foreground'>
            {checkedCount} account được chọn
          </span>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={saveMut.isPending}
            >
              Huỷ
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || isLoading}
            >
              {saveMut.isPending ? (
                <>
                  <Loader2 className='me-2 size-3.5 animate-spin' />
                  Đang lưu...
                </>
              ) : (
                'Lưu'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ListProps {
  accounts: TiktokAccount[]
  checked: Set<string>
  currentGroupId: string
  onToggle: (id: string) => void
}

function AccountCheckboxList({ accounts, checked, currentGroupId, onToggle }: ListProps) {
  return (
    <div className='space-y-2 pr-3'>
      {accounts.map((acc) => {
        const isChecked = checked.has(acc._id)
        const belongsElsewhere =
          acc.groupId != null &&
          acc.groupId !== currentGroupId &&
          !isChecked

        return (
          <label
            key={acc._id}
            className='flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted'
          >
            <Checkbox
              checked={isChecked}
              onCheckedChange={() => onToggle(acc._id)}
            />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium'>{acc.name}</p>
              <p className='truncate text-xs text-muted-foreground'>
                {acc.shopId} · {acc.shopRegion}
              </p>
            </div>
            {belongsElsewhere && (
              <Badge variant='secondary' className='shrink-0 text-xs'>
                Nhóm khác
              </Badge>
            )}
            {acc.cookieAlive === false && (
              <Badge variant='destructive' className='shrink-0 text-xs'>
                Cookie chết
              </Badge>
            )}
            {acc.active === false && (
              <Badge variant='outline' className='shrink-0 text-xs'>
                Disabled
              </Badge>
            )}
          </label>
        )
      })}
    </div>
  )
}
