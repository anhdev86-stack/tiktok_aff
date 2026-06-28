import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  HelpCircle,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { serviceAccountApi, tiktokAccountApi } from '@/lib/api-endpoints'
import type {
  CreateTiktokAccountInput,
  TiktokAccount,
  UpdateTiktokAccountInput,
} from '@/lib/api-types'
import { friendlyCookieError } from '@/lib/cookie-error-message'
import { handleServerError } from '@/lib/handle-server-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

export function TiktokAccountsPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TiktokAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TiktokAccount | null>(null)

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['tiktok-accounts'],
    queryFn: () => tiktokAccountApi.list(),
  })

  const { data: saEmails } = useQuery({
    queryKey: ['service-account-emails'],
    queryFn: () => serviceAccountApi.emails(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tiktokAccountApi.remove(id),
    onSuccess: () => {
      toast.success('Đã xoá TikTok account')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] })
    },
    onError: handleServerError,
  })

  const checkCookieMutation = useMutation({
    mutationFn: (id: string) => tiktokAccountApi.checkCookie(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] })
      if (r.alive === true) toast.success('Cookie còn sống.')
      else toast.error(friendlyCookieError(r.message))
    },
    onError: handleServerError,
  })

  const activeEmails = (saEmails ?? []).filter((s) => s.active)

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
          <div className='min-w-0'>
            <h1 className='text-2xl font-bold tracking-tight'>TikTok Accounts</h1>
            <p className='text-sm text-muted-foreground'>
              Mỗi shop = 1 record (cookie + shopId + spreadsheet). Cookie được mã hoá AES-256-GCM trước khi lưu.
            </p>
          </div>
          <Button className='shrink-0 self-start' onClick={() => setCreateOpen(true)}>
            <Plus className='me-2 size-4' /> Thêm TikTok Account
          </Button>
        </div>

        {activeEmails.length === 0 ? (
          <Alert variant='destructive' className='mb-4'>
            <ShieldAlert />
            <AlertTitle>Chưa có Service Account active</AlertTitle>
            <AlertDescription>
              Vào trang <strong>Service Accounts</strong> để thêm SA trước khi tạo TikTok account, nếu không sheet sẽ ghi fail.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className='mb-4'>
            <ShieldAlert />
            <AlertTitle>Quan trọng — share Spreadsheet</AlertTitle>
            <AlertDescription>
              <p className='mb-2'>
                Trước khi tạo, hãy share <strong>Editor</strong> spreadsheet (hoặc thư mục cha) cho các SA email sau:
              </p>
              <div className='flex flex-wrap gap-1'>
                {activeEmails.map((s) => (
                  <code
                    key={s.id}
                    className='rounded bg-muted px-2 py-0.5 text-xs'
                  >
                    {s.clientEmail}
                  </code>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='space-y-2 p-4'>
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
              </div>
            ) : !accounts || accounts.length === 0 ? (
              <div className='p-8 text-center text-sm text-muted-foreground'>
                Chưa có TikTok Account.
              </div>
            ) : (
              <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tên</TableHead>
                    <TableHead>Shop ID</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Cookie</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-end'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc) => (
                    <TableRow key={acc._id}>
                      <TableCell className='font-medium'>{acc.name}</TableCell>
                      <TableCell className='text-xs'>{acc.shopId}</TableCell>
                      <TableCell className='text-xs'>{acc.shopRegion}</TableCell>
                      <TableCell>
                        <CookieStatusBadge acc={acc} />
                      </TableCell>
                      <TableCell>
                        {acc.active === false ? (
                          <Badge variant='secondary'>Disabled</Badge>
                        ) : (
                          <Badge variant='default'>Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className='space-x-1 text-end'>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={
                            checkCookieMutation.isPending &&
                            checkCookieMutation.variables === acc._id
                          }
                          onClick={() => checkCookieMutation.mutate(acc._id)}
                        >
                          <RefreshCcw className='me-1 size-3.5' />
                          Check cookie
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          onClick={() => setEditTarget(acc)}
                          title='Sửa'
                        >
                          <Pencil className='size-4' />
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='text-destructive'
                          onClick={() => setDeleteTarget(acc)}
                          title='Xoá'
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </Main>

      <CreateTiktokAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <EditTiktokAccountDialog
        target={editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title='Xoá TikTok Account?'
        desc={
          deleteTarget
            ? `Xoá ${deleteTarget.name}? Toàn bộ tracked creators và profile jobs liên quan có thể bị orphan.`
            : ''
        }
        confirmText='Xoá'
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget._id)
        }}
      />

    </>
  )
}

function CreateTiktokAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<CreateTiktokAccountInput>({
    name: '',
    cookie: '',
    shopId: '',
    shopRegion: 'US',
  })

  const create = useMutation({
    mutationFn: () => tiktokAccountApi.create(form),
    onSuccess: () => {
      toast.success('Đã tạo TikTok account')
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] })
      onOpenChange(false)
      setForm({ name: '', cookie: '', shopId: '', shopRegion: 'US' })
    },
    onError: handleServerError,
  })

  const update = (k: keyof CreateTiktokAccountInput, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const valid = form.name && form.cookie && form.shopId && form.shopRegion

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Thêm TikTok Account</DialogTitle>
          <DialogDescription>
            Cookie được mã hoá AES-256-GCM trước khi lưu DB.
          </DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div className='grid gap-1.5 sm:col-span-2'>
            <Label htmlFor='name'>Tên</Label>
            <Input
              id='name'
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder='Shop A — US'
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='shopId'>Shop ID</Label>
            <Input
              id='shopId'
              value={form.shopId}
              onChange={(e) => update('shopId', e.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='region'>Region</Label>
            <Input
              id='region'
              value={form.shopRegion}
              onChange={(e) => update('shopRegion', e.target.value)}
              placeholder='US, GB, ID...'
            />
          </div>
          <div className='grid gap-1.5 sm:col-span-2'>
            <Label htmlFor='cookie'>Cookie</Label>
            <Textarea
              id='cookie'
              rows={4}
              value={form.cookie}
              onChange={(e) => update('cookie', e.target.value)}
              placeholder='Toàn bộ cookie từ trình duyệt'
              className='font-mono text-xs break-all'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTiktokAccountDialog({
  target,
  onOpenChange,
}: {
  target: TiktokAccount | null
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<UpdateTiktokAccountInput>({})

  // Re-init form when target changes
  useEffect(() => {
    if (target) {
      setForm({
        name: target.name,
        shopId: target.shopId,
        shopRegion: target.shopRegion,
        active: target.active !== false,
        // cookie để trống — chỉ update khi user nhập mới
        cookie: '',
      })
    }
  }, [target])

  const update = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('No target')
      // Loại bỏ cookie nếu rỗng (giữ cookie cũ trong DB)
      const payload: UpdateTiktokAccountInput = { ...form }
      if (!payload.cookie) delete payload.cookie
      return tiktokAccountApi.update(target._id, payload)
    },
    onSuccess: () => {
      toast.success('Đã cập nhật TikTok account')
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] })
      onOpenChange(false)
    },
    onError: handleServerError,
  })

  const setField = <K extends keyof UpdateTiktokAccountInput>(
    k: K,
    v: UpdateTiktokAccountInput[K],
  ) => setForm((f) => ({ ...f, [k]: v }))

  const valid = !!form.name && !!form.shopId && !!form.shopRegion

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Sửa TikTok Account</DialogTitle>
          <DialogDescription>
            Để trống Cookie nếu không muốn cập nhật. Cookie mới sẽ thay thế cookie cũ và được mã hoá AES-256-GCM.
          </DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div className='grid gap-1.5 sm:col-span-2'>
            <Label htmlFor='edit-name'>Tên</Label>
            <Input
              id='edit-name'
              value={form.name ?? ''}
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='edit-shopId'>Shop ID</Label>
            <Input
              id='edit-shopId'
              value={form.shopId ?? ''}
              onChange={(e) => setField('shopId', e.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='edit-region'>Region</Label>
            <Input
              id='edit-region'
              value={form.shopRegion ?? ''}
              onChange={(e) => setField('shopRegion', e.target.value)}
            />
          </div>
          <div className='grid gap-1.5 sm:col-span-2'>
            <Label htmlFor='edit-cookie'>Cookie (để trống = giữ nguyên)</Label>
            <Textarea
              id='edit-cookie'
              rows={4}
              value={form.cookie ?? ''}
              onChange={(e) => setField('cookie', e.target.value)}
              placeholder='Chỉ nhập nếu muốn thay cookie mới'
              className='font-mono text-xs break-all'
            />
          </div>
          <div className='flex items-center gap-2 sm:col-span-2'>
            <input
              id='edit-active'
              type='checkbox'
              checked={form.active !== false}
              onChange={(e) => setField('active', e.target.checked)}
              className='size-4'
            />
            <Label htmlFor='edit-active' className='cursor-pointer'>
              Active (bỏ tick = disable, sẽ không dùng làm master cookie)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            disabled={!valid || update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CookieStatusBadge({ acc }: { acc: TiktokAccount }) {
  const checkedAt = acc.cookieCheckedAt
    ? new Date(acc.cookieCheckedAt).toLocaleString()
    : null
  const tooltip = [acc.cookieCheckMessage, checkedAt && `Checked: ${checkedAt}`]
    .filter(Boolean)
    .join(' — ')

  if (acc.cookieAlive === true) {
    return (
      <Badge
        variant='default'
        className='gap-1 bg-emerald-600 hover:bg-emerald-600'
        title={tooltip || undefined}
      >
        <CheckCircle2 className='size-3.5' /> Alive
      </Badge>
    )
  }
  if (acc.cookieAlive === false) {
    return (
      <Badge variant='destructive' className='gap-1' title={tooltip || undefined}>
        <XCircle className='size-3.5' /> Dead
      </Badge>
    )
  }
  return (
    <Badge variant='secondary' className='gap-1'>
      <HelpCircle className='size-3.5' /> Chưa kiểm tra
    </Badge>
  )
}
