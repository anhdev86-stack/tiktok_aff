import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  CircleCheck,
  CircleX,
  Copy,
  Loader2,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { appSettingsApi, serviceAccountApi } from '@/lib/api-endpoints'
import type { SaHealthResult, ServiceAccount } from '@/lib/api-types'
import { handleServerError } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

export function ServiceAccountsPage() {
  const qc = useQueryClient()
  const [openCreate, setOpenCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ServiceAccount | null>(null)
  // Kết quả health-check theo saId — set sau khi bấm "Kiểm tra".
  const [health, setHealth] = useState<Record<string, SaHealthResult>>({})

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['service-accounts'],
    queryFn: () => serviceAccountApi.list(),
  })

  // Lấy spreadsheetId đang cấu hình để check luôn "có quyền vào sheet không".
  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => appSettingsApi.get(),
  })
  const spreadsheetId = settings?.spreadsheetId || undefined

  const mergeResults = (results: SaHealthResult[]) =>
    setHealth((prev) => {
      const next = { ...prev }
      for (const r of results) next[r.saId] = r
      return next
    })

  const checkAll = useMutation({
    mutationFn: () => serviceAccountApi.health(spreadsheetId),
    onSuccess: (results) => {
      mergeResults(results)
      const bad = results.filter(
        (r) => !r.credentialsOk || r.sheetAccessOk === false
      )
      if (bad.length === 0) {
        toast.success(`Tất cả ${results.length} SA hợp lệ`)
      } else {
        toast.warning(`${bad.length}/${results.length} SA có vấn đề — xem cột Health`)
      }
    },
    onError: handleServerError,
  })

  const checkOne = useMutation({
    mutationFn: (id: string) => serviceAccountApi.healthOne(id, spreadsheetId),
    onSuccess: (results) => mergeResults(results),
    onError: handleServerError,
  })

  const toggleMutation = useMutation({
    mutationFn: (sa: ServiceAccount) =>
      serviceAccountApi.update(sa.id, { active: !sa.active }),
    onSuccess: (_, sa) => {
      toast.success(sa.active ? 'Đã tạm khoá SA' : 'Đã kích hoạt SA')
      qc.invalidateQueries({ queryKey: ['service-accounts'] })
      qc.invalidateQueries({ queryKey: ['service-account-emails'] })
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serviceAccountApi.remove(id),
    onSuccess: () => {
      toast.success('Đã xoá Service Account')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['service-accounts'] })
      qc.invalidateQueries({ queryKey: ['service-account-emails'] })
    },
    onError: handleServerError,
  })

  const copyEmail = async (email: string) => {
    await navigator.clipboard.writeText(email)
    toast.success('Đã copy email — share quyền Editor cho email này trên Google Drive/Sheets')
  }

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
          <div className='min-w-0'>
            <h1 className='text-2xl font-bold tracking-tight'>Service Accounts</h1>
            <p className='text-sm text-muted-foreground'>
              Dán JSON service account của Google Cloud vào đây. Backend mã hoá AES-256-GCM trước khi lưu DB.
            </p>
          </div>
          <div className='flex shrink-0 gap-2 self-start'>
            <Button
              variant='outline'
              disabled={checkAll.isPending || !accounts?.length}
              onClick={() => checkAll.mutate()}
              title={
                spreadsheetId
                  ? 'Check credential + quyền vào sheet đang cấu hình'
                  : 'Chưa cấu hình spreadsheetId — chỉ check credential'
              }
            >
              {checkAll.isPending ? (
                <Loader2 className='me-2 size-4 animate-spin' />
              ) : (
                <ShieldCheck className='me-2 size-4' />
              )}
              Kiểm tra tất cả
            </Button>
            <Button onClick={() => setOpenCreate(true)}>
              <Plus className='me-2 size-4' /> Thêm SA
            </Button>
          </div>
        </div>

        <Card className='mb-4'>
          <CardHeader>
            <CardTitle className='text-base'>Hướng dẫn share quyền</CardTitle>
            <CardDescription>
              Copy <code>client_email</code> phía dưới rồi share <strong>Editor</strong> trên Google Sheets/Drive
              hoặc cấp quyền cho cả thư mục chứa file.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='space-y-2 p-4'>
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
              </div>
            ) : !accounts || accounts.length === 0 ? (
              <div className='p-8 text-center text-sm text-muted-foreground'>
                Chưa có Service Account. Bấm <strong>Thêm SA</strong> để dán JSON đầu tiên.
              </div>
            ) : (
              <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Client email</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Cooldown</TableHead>
                    <TableHead className='text-end'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((sa) => {
                    const cooling =
                      sa.cooldownUntil && new Date(sa.cooldownUntil) > new Date()
                    return (
                      <TableRow key={sa.id}>
                        <TableCell className='font-medium'>{sa.label}</TableCell>
                        <TableCell>
                          <div className='flex items-center gap-2'>
                            <code className='text-xs'>{sa.clientEmail}</code>
                            <Button
                              size='icon'
                              variant='ghost'
                              className='h-6 w-6'
                              onClick={() => copyEmail(sa.clientEmail)}
                            >
                              <Copy className='size-3' />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className='text-xs'>{sa.projectId}</TableCell>
                        <TableCell>
                          {sa.active ? (
                            <Badge variant='default'>Active</Badge>
                          ) : (
                            <Badge variant='secondary'>Disabled</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <HealthCell
                            result={health[sa.id]}
                            pending={
                              checkOne.isPending && checkOne.variables === sa.id
                            }
                          />
                        </TableCell>
                        <TableCell className='text-xs text-muted-foreground'>
                          {cooling
                            ? `Đến ${format(new Date(sa.cooldownUntil!), 'HH:mm dd/MM')}`
                            : '—'}
                        </TableCell>
                        <TableCell className='text-end'>
                          <Button
                            size='icon'
                            variant='ghost'
                            disabled={
                              checkOne.isPending && checkOne.variables === sa.id
                            }
                            onClick={() => checkOne.mutate(sa.id)}
                            title='Kiểm tra SA này'
                          >
                            {checkOne.isPending &&
                            checkOne.variables === sa.id ? (
                              <Loader2 className='size-4 animate-spin' />
                            ) : (
                              <ShieldCheck className='size-4' />
                            )}
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            disabled={toggleMutation.isPending}
                            onClick={() => toggleMutation.mutate(sa)}
                            title={sa.active ? 'Tạm khoá' : 'Kích hoạt'}
                          >
                            <Power className='size-4' />
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='text-destructive'
                            onClick={() => setDeleteTarget(sa)}
                          >
                            <Trash2 className='size-4' />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </Main>

      <CreateServiceAccountDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title='Xoá Service Account?'
        desc={
          deleteTarget
            ? `Xoá ${deleteTarget.clientEmail}? Các job đang chạy trên SA này sẽ fail.`
            : ''
        }
        confirmText='Xoá'
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </>
  )
}

function HealthCell({
  result,
  pending,
}: {
  result?: SaHealthResult
  pending: boolean
}) {
  if (pending) {
    return (
      <span className='flex items-center gap-1 text-xs text-muted-foreground'>
        <Loader2 className='size-3 animate-spin' /> Đang kiểm tra…
      </span>
    )
  }
  if (!result) {
    return <span className='text-xs text-muted-foreground'>Chưa kiểm tra</span>
  }
  if (!result.credentialsOk) {
    return (
      <Badge variant='destructive' className='gap-1' title={result.error}>
        <CircleX className='size-3' /> Credential lỗi
      </Badge>
    )
  }
  if (result.sheetAccessOk === false) {
    return (
      <Badge
        variant='outline'
        className='gap-1 border-amber-500 text-amber-600'
        title={result.error}
      >
        <TriangleAlert className='size-3' /> Chưa share sheet
      </Badge>
    )
  }
  return (
    <Badge
      variant='outline'
      className='gap-1 border-emerald-500 text-emerald-600'
      title={
        result.sheetAccessOk === true
          ? 'Credential + quyền sheet OK'
          : 'Credential OK (chưa probe sheet)'
      }
    >
      <CircleCheck className='size-3' />
      {result.sheetAccessOk === true ? 'OK' : 'Credential OK'}
    </Badge>
  )
}

function CreateServiceAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [json, setJson] = useState('')
  const [note, setNote] = useState('')

  const create = useMutation({
    mutationFn: () =>
      serviceAccountApi.create({
        label: label || undefined,
        sa: json,
        note: note || undefined,
      }),
    onSuccess: () => {
      toast.success('Đã thêm Service Account')
      qc.invalidateQueries({ queryKey: ['service-accounts'] })
      qc.invalidateQueries({ queryKey: ['service-account-emails'] })
      setLabel('')
      setJson('')
      setNote('')
      onOpenChange(false)
    },
    onError: handleServerError,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Thêm Service Account</DialogTitle>
          <DialogDescription>
            Dán nguyên file JSON tải từ Google Cloud Console (IAM &amp; Admin → Service Accounts → Keys → Add key → JSON).
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='sa-label'>Label (tuỳ chọn)</Label>
            <Input
              id='sa-label'
              placeholder='Auto từ client_email nếu để trống'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='sa-json'>JSON Service Account</Label>
            <Textarea
              id='sa-json'
              placeholder='{ "type": "service_account", "project_id": "...", "private_key": "-----BEGIN PRIVATE KEY-----\\n...", "client_email": "x@x.iam.gserviceaccount.com", ... }'
              rows={12}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              className='font-mono text-xs break-all'
            />
            <p className='text-xs text-muted-foreground'>
              Backend kiểm tra type, client_email, private_key trước khi lưu.
            </p>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='sa-note'>Ghi chú</Label>
            <Input
              id='sa-note'
              placeholder='vd: SA Project A — phục vụ shop US'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            disabled={!json.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
