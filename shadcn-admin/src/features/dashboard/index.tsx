import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowRight,
  Key,
  Radio,
  ShieldCheck,
  ShoppingBag,
  UserSearch,
} from 'lucide-react'
import {
  auditLogApi,
  crawlerApi,
  serviceAccountApi,
  tiktokAccountApi,
} from '@/lib/api-endpoints'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

export function Dashboard() {
  const { data: sas } = useQuery({
    queryKey: ['service-accounts'],
    queryFn: () => serviceAccountApi.list(),
  })
  const { data: accounts } = useQuery({
    queryKey: ['tiktok-accounts'],
    queryFn: () => tiktokAccountApi.list(),
  })
  const { data: crawlerGroups } = useQuery({
    queryKey: ['crawler-all-status'],
    queryFn: crawlerApi.allStatus,
    refetchInterval: 5000,
  })
  const { data: logs } = useQuery({
    queryKey: ['audit-logs', 'recent'],
    queryFn: () => auditLogApi.list({ size: 10 }),
    refetchInterval: 8000,
  })

  const activeSAs = (sas ?? []).filter((s) => s.active).length
  const activeAccounts = (accounts ?? []).filter((a) => a.active !== false).length
  const aliveAccounts = (accounts ?? []).filter((a) => a.cookieAlive === true).length
  const anyGroupRunning = (crawlerGroups ?? []).some(
    (g) => g.running || g.status === 'running' || g.status === 'sleeping',
  )

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4'>
          <h1 className='text-2xl font-bold tracking-tight'>Dashboard</h1>
          <p className='text-sm text-muted-foreground'>
            Tổng quan hệ thống TikTok Affiliate Admin.
          </p>
        </div>

        <div className='mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          <StatCard
            title='Service Accounts'
            icon={<Key className='size-4 text-muted-foreground' />}
            value={sas == null ? null : `${activeSAs}/${sas.length}`}
            hint={sas == null ? '' : 'active / tổng'}
            link='/service-accounts'
          />
          <StatCard
            title='TikTok Accounts'
            icon={<ShoppingBag className='size-4 text-muted-foreground' />}
            value={accounts == null ? null : `${activeAccounts}/${accounts.length}`}
            hint={accounts == null ? '' : 'active / tổng'}
            link='/tiktok-accounts'
          />
          <StatCard
            title='Cookie alive'
            icon={<ShieldCheck className='size-4 text-muted-foreground' />}
            value={accounts == null ? null : aliveAccounts.toString()}
            hint={accounts == null ? '' : 'tài khoản cookie còn sống'}
            link='/tiktok-accounts'
          />
          <StatCard
            title='Crawler'
            icon={<Radio className='size-4 text-muted-foreground' />}
            value={crawlerGroups == null ? null : anyGroupRunning ? 'Running' : 'Stopped'}
            hint={crawlerGroups == null ? '' : anyGroupRunning ? 'có nhóm đang chạy' : 'tất cả đã dừng'}
            link='/crawler'
          />
        </div>

        <div className='grid gap-3 lg:grid-cols-2'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-base'>Creators</CardTitle>
              <Link to='/creators'>
                <Button size='sm' variant='ghost'>
                  Cấu hình <ArrowRight className='ms-1 size-3' />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className='flex items-center gap-3'>
                <UserSearch className='size-8 text-muted-foreground' />
                <div>
                  <p className='text-sm font-medium'>Cấu hình danh mục crawler</p>
                  <p className='text-xs text-muted-foreground'>
                    Chọn ngành hàng để crawler tự động thu thập creator từ TikTok
                    marketplace.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <ShieldCheck className='size-4' />
                Audit log gần đây
              </CardTitle>
              <Link to='/audit-logs'>
                <Button size='sm' variant='ghost'>
                  Xem tất cả <ArrowRight className='ms-1 size-3' />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className='p-0'>
              {!logs ? (
                <div className='space-y-2 p-4'>
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                </div>
              ) : logs.items.length === 0 ? (
                <p className='p-6 text-center text-sm text-muted-foreground'>
                  Chưa có log.
                </p>
              ) : (
                <ul className='divide-y'>
                  {logs.items.map((l) => (
                    <li
                      key={l._id}
                      className='flex items-center gap-3 p-3'
                    >
                      <code className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs'>
                        {l.action}
                      </code>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-xs'>
                          <strong>{l.actor ?? '—'}</strong>
                          {l.ip ? ` · ${l.ip}` : ''}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          {format(new Date(l.createdAt), 'HH:mm:ss dd/MM')}
                        </p>
                      </div>
                      {l.success === false && (
                        <Badge variant='destructive'>fail</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}

function StatCard({
  title,
  icon,
  value,
  hint,
  link,
}: {
  title: string
  icon: React.ReactNode
  value: string | null
  hint: string
  link: string
}) {
  return (
    <Link to={link}>
      <Card className='transition hover:bg-muted/40'>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          {value == null ? (
            <Skeleton className='h-8 w-20' />
          ) : (
            <div className='text-2xl font-bold'>{value}</div>
          )}
          <p className='text-xs text-muted-foreground'>{hint}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
