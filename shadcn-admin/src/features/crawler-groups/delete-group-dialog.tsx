/**
 * Confirm xoá một CrawlerGroup.
 * Nếu BE trả lỗi (còn accounts) → toast error rõ ràng.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crawlerGroupApi } from '@/lib/api-endpoints'
import type { CrawlerGroup } from '@/lib/api-types'
import { handleServerError } from '@/lib/handle-server-error'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  group: CrawlerGroup
  onSuccess: () => void
}

export function DeleteGroupDialog({ open, onOpenChange, group, onSuccess }: Props) {
  const qc = useQueryClient()

  const deleteMut = useMutation({
    mutationFn: () => crawlerGroupApi.remove(group._id),
    onSuccess: () => {
      toast.success(`Đã xoá nhóm "${group.name}"`)
      qc.invalidateQueries({ queryKey: ['crawler-groups'] })
      onOpenChange(false)
      onSuccess()
    },
    onError: (err) => {
      // handleServerError hiển thị message từ BE (vd: "Hãy chuyển X account sang nhóm khác trước")
      handleServerError(err)
    },
  })

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Xoá nhóm "${group.name}"?`}
      desc={
        `Thao tác này không thể hoàn tác. Nếu nhóm còn TikTok Accounts, ` +
        `hãy chuyển chúng sang nhóm khác trước khi xoá.`
      }
      confirmText='Xoá'
      destructive
      isLoading={deleteMut.isPending}
      handleConfirm={() => deleteMut.mutate()}
    />
  )
}
