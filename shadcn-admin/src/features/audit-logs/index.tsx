import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { auditLogApi } from '@/lib/api-endpoints'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

export function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit-logs', page, actor, action],
    queryFn: () =>
      auditLogApi.list({
        page,
        size: 50,
        actor: actor || undefined,
        action: action || undefined,
      }),
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
          <div className='min-w-0'>
            <h1 className='text-2xl font-bold tracking-tight'>Audit Logs</h1>
            <p className='text-sm text-muted-foreground'>
              Lưu mọi action có ý nghĩa: login, tạo/sửa/xoá SA, tạo job, gọi sheet.
            </p>
          </div>
          <Button
            variant='outline'
            size='icon'
            onClick={() => refetch()}
            disabled={isFetching}
            className='shrink-0 self-start'
          >
            <RefreshCw
              className={'size-4' + (isFetching ? ' animate-spin' : '')}
            />
          </Button>
        </div>

        <div className='mb-3 flex flex-col gap-2 sm:flex-row'>
          <Input
            placeholder='Filter actor (vd: admin)'
            value={actor}
            onChange={(e) => {
              setPage(1)
              setActor(e.target.value)
            }}
            className='sm:max-w-xs'
          />
          <Input
            placeholder='Filter action (vd: auth.login)'
            value={action}
            onChange={(e) => {
              setPage(1)
              setAction(e.target.value)
            }}
            className='sm:max-w-xs'
          />
        </div>

        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='space-y-2 p-4'>
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className='p-8 text-center text-sm text-muted-foreground'>
                Không có log.
              </div>
            ) : (
              <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>OK</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((log) => (
                    <TableRow key={log._id}>
                      <TableCell className='text-xs'>
                        {format(new Date(log.createdAt), 'HH:mm:ss dd/MM')}
                      </TableCell>
                      <TableCell className='text-xs font-medium'>
                        {log.actor ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline' className='font-mono text-xs'>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className='max-w-[200px] truncate text-xs'>
                        {log.targetType ? (
                          <span>
                            <span className='text-muted-foreground'>
                              {log.targetType}
                            </span>
                            {log.targetId ? `:${log.targetId.slice(-8)}` : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {log.success === false ? (
                          <XCircle className='size-4 text-destructive' />
                        ) : (
                          <CheckCircle2 className='size-4 text-green-600' />
                        )}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {log.ip ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {data && data.total > 0 && (
          <div className='mt-3 flex items-center justify-between'>
            <p className='text-xs text-muted-foreground'>
              Trang {data.page} / {totalPages} — {data.total} bản ghi
            </p>
            <div className='space-x-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Trước
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </Button>
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
