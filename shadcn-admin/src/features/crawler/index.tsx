/**
 * Crawler Monitor — multi-group view with 2s polling.
 * Route: /crawler
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FolderPlus } from 'lucide-react'
import { crawlerApi } from '@/lib/api-endpoints'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { CrawlerStatusCard } from './crawler-status-card'

export function CrawlerPage() {
  const { data: groups, isLoading } = useQuery({
    queryKey: ['crawler-all-status'],
    queryFn: crawlerApi.allStatus,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  })

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Crawler</h1>
            <p className='text-sm text-muted-foreground'>
              Theo dõi và điều khiển từng nhóm crawler tự động.
            </p>
          </div>
          <Button asChild className='shrink-0 self-start'>
            <Link to='/crawler-groups'>
              <FolderPlus className='me-2 size-4' />
              Quản lý nhóm
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <div className='grid gap-4 sm:grid-cols-2'>
            <Skeleton className='h-48 w-full' />
            <Skeleton className='h-48 w-full' />
          </div>
        ) : !groups || groups.length === 0 ? (
          <EmptyState />
        ) : (
          <div className='grid gap-4 sm:grid-cols-2'>
            {groups.map((group) => (
              <CrawlerStatusCard key={group._id} group={group} />
            ))}
          </div>
        )}
      </Main>
    </>
  )
}

function EmptyState() {
  return (
    <div className='flex flex-col items-center gap-4 rounded-lg border border-dashed py-16 text-center'>
      <p className='text-sm text-muted-foreground'>
        Chưa có nhóm nào — Tạo nhóm đầu tiên để bắt đầu crawler.
      </p>
      <Button asChild variant='outline'>
        <Link to='/crawler-groups'>
          <FolderPlus className='me-2 size-4' />
          Tạo nhóm đầu tiên
        </Link>
      </Button>
    </div>
  )
}
