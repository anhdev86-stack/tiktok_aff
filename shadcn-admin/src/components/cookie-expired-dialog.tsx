import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { tiktokAccountApi } from '@/lib/api-endpoints'
import { handleServerError } from '@/lib/handle-server-error'
import { useCookiePromptStore } from '@/stores/cookie-prompt-store'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Bật khi axios interceptor phát hiện 409 COOKIE_EXPIRED. Buộc user dán
 * cookie mới + auto re-check; chỉ đóng khi cookie sống lại.
 */
export function CookieExpiredDialog() {
  const target = useCookiePromptStore((s) => s.target)
  const close = useCookiePromptStore((s) => s.close)
  const qc = useQueryClient()
  const [cookie, setCookie] = useState('')
  const [probeError, setProbeError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setCookie('')
      setProbeError(null)
    }
  }, [target])

  const submit = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('No target')
      await tiktokAccountApi.update(target.accountId, { cookie })
      const r = await tiktokAccountApi.checkCookie(target.accountId)
      return r
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] })
      if (r.alive === true) {
        toast.success('Cookie đã được cập nhật và còn sống.')
        close()
      } else {
        setProbeError(r.message ?? 'Cookie vẫn chưa được TikTok chấp nhận.')
      }
    },
    onError: (err) => {
      handleServerError(err)
    },
  })

  const open = !!target

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submit.isPending) close()
      }}
    >
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Cookie TikTok đã hết hạn</DialogTitle>
          <DialogDescription>
            {target?.accountName ? (
              <>
                Cookie của account <strong>{target.accountName}</strong> không
                còn hợp lệ. Dán cookie mới để tiếp tục.
              </>
            ) : (
              <>Cookie không còn hợp lệ. Dán cookie mới để tiếp tục.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {(target?.message || probeError) && (
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertTitle>Cookie chết</AlertTitle>
            <AlertDescription>
              {probeError ?? target?.message}
            </AlertDescription>
          </Alert>
        )}

        <div className='grid gap-1.5'>
          <Label htmlFor='new-cookie'>Cookie mới</Label>
          <Textarea
            id='new-cookie'
            rows={6}
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder='Toàn bộ cookie từ trình duyệt'
            className='font-mono text-xs break-all'
          />
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            disabled={submit.isPending}
            onClick={() => close()}
          >
            Để sau
          </Button>
          <Button
            disabled={!cookie.trim() || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? 'Đang kiểm tra...' : 'Cập nhật & kiểm tra'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
