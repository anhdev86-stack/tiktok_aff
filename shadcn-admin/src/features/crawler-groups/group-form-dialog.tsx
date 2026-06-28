/**
 * Dialog tạo / sửa một CrawlerGroup.
 * - Create mode: props.group = undefined
 * - Edit mode:   props.group = CrawlerGroup (prefill form)
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crawlerGroupApi } from '@/lib/api-endpoints'
import type {
  CreateCrawlerGroupInput,
  CrawlerGroup,
} from '@/lib/api-types'
import { handleServerError } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  group?: CrawlerGroup
  onSuccess: () => void
}

type FormState = {
  name: string
  spreadsheetId: string
  sheetOverview: string
  sheetTopVideos: string
  sheetTrend: string
}

const DEFAULTS: FormState = {
  name: '',
  spreadsheetId: '',
  sheetOverview: 'Tổng quan',
  sheetTopVideos: 'Video nổi bật',
  sheetTrend: 'Xu hướng',
}

export function GroupFormDialog({ open, onOpenChange, group, onSuccess }: Props) {
  const qc = useQueryClient()
  const isEdit = !!group

  const [form, setForm] = useState<FormState>(DEFAULTS)

  // Prefill khi edit mode
  useEffect(() => {
    if (group) {
      setForm({
        name: group.name,
        spreadsheetId: group.spreadsheetId ?? '',
        sheetOverview: group.sheetOverview || 'Tổng quan',
        sheetTopVideos: group.sheetTopVideos || 'Video nổi bật',
        sheetTrend: group.sheetTrend || 'Xu hướng',
      })
    } else {
      setForm(DEFAULTS)
    }
  }, [group, open])

  const set = (k: keyof FormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const createMut = useMutation({
    mutationFn: (data: CreateCrawlerGroupInput) => crawlerGroupApi.create(data),
    onSuccess: () => {
      toast.success('Đã tạo nhóm crawler')
      qc.invalidateQueries({ queryKey: ['crawler-groups'] })
      onOpenChange(false)
      onSuccess()
    },
    onError: handleServerError,
  })

  const updateMut = useMutation({
    mutationFn: (data: CreateCrawlerGroupInput) =>
      crawlerGroupApi.update(group!._id, data),
    onSuccess: () => {
      toast.success('Đã cập nhật nhóm crawler')
      qc.invalidateQueries({ queryKey: ['crawler-groups'] })
      onOpenChange(false)
      onSuccess()
    },
    onError: handleServerError,
  })

  const isPending = createMut.isPending || updateMut.isPending
  const valid = form.name.trim().length > 0

  const handleSubmit = () => {
    if (!valid) return
    const payload: CreateCrawlerGroupInput = {
      name: form.name.trim(),
      spreadsheetId: form.spreadsheetId.trim() || undefined,
      sheetOverview: form.sheetOverview.trim() || 'Tổng quan',
      sheetTopVideos: form.sheetTopVideos.trim() || 'Video nổi bật',
      sheetTrend: form.sheetTrend.trim() || 'Xu hướng',
      categoryList: [],
    }
    if (isEdit) {
      updateMut.mutate(payload)
    } else {
      createMut.mutate(payload)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa nhóm crawler' : 'Tạo nhóm crawler'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Cập nhật thông tin nhóm crawler.'
              : 'Điền thông tin để tạo nhóm crawler mới.'}
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='cg-name'>
              Tên nhóm <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='cg-name'
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder='Nhóm chính, Nhóm phụ...'
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='cg-ssid'>Spreadsheet ID</Label>
            <Input
              id='cg-ssid'
              value={form.spreadsheetId}
              onChange={(e) => set('spreadsheetId', e.target.value)}
              placeholder='ID từ URL /d/.../edit'
            />
            <p className='text-xs text-muted-foreground'>
              Lấy từ URL Google Sheet: ...spreadsheets/d/<strong>ID</strong>/edit
            </p>
          </div>

          <div className='grid grid-cols-3 gap-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='cg-overview'>Sheet Tổng quan</Label>
              <Input
                id='cg-overview'
                value={form.sheetOverview}
                onChange={(e) => set('sheetOverview', e.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='cg-topvideos'>Sheet Video nổi bật</Label>
              <Input
                id='cg-topvideos'
                value={form.sheetTopVideos}
                onChange={(e) => set('sheetTopVideos', e.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='cg-trend'>Sheet Xu hướng</Label>
              <Input
                id='cg-trend'
                value={form.sheetTrend}
                onChange={(e) => set('sheetTrend', e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isPending}>
            Huỷ
          </Button>
          <Button disabled={!valid || isPending} onClick={handleSubmit}>
            {isPending ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Tạo nhóm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
