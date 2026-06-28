/**
 * Trang quản lý Crawler Groups — list, create, edit, delete, assign accounts.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Plus } from 'lucide-react'
import { crawlerGroupApi } from '@/lib/api-endpoints'
import type { CrawlerGroup } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { DeleteGroupDialog } from './delete-group-dialog'
import { GroupAccountsDialog } from './group-accounts-dialog'
import { GroupCard } from './group-card'
import { GroupFormDialog } from './group-form-dialog'

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; group: CrawlerGroup }
  | { kind: 'accounts'; group: CrawlerGroup }
  | { kind: 'delete'; group: CrawlerGroup }

export function CrawlerGroupsPage() {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })

  const { data: groups, isLoading } = useQuery({
    queryKey: ['crawler-groups'],
    queryFn: () => crawlerGroupApi.list(),
    refetchInterval: 10_000,
  })

  const close = () => setDialog({ kind: 'none' })

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        {/* Page header */}
        <div className='mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Crawler Groups</h1>
            <p className='text-sm text-muted-foreground'>
              Quản lý nhóm crawler — mỗi nhóm có spreadsheet riêng và danh sách
              TikTok Accounts.
            </p>
          </div>
          <Button
            className='shrink-0 self-start'
            onClick={() => setDialog({ kind: 'create' })}
          >
            <Plus className='me-2 size-4' />
            Tạo nhóm
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : !groups || groups.length === 0 ? (
          <EmptyState onCreateClick={() => setDialog({ kind: 'create' })} />
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {groups.map((g) => (
              <GroupCard
                key={g._id}
                group={g}
                onEdit={(group) => setDialog({ kind: 'edit', group })}
                onManageAccounts={(group) => setDialog({ kind: 'accounts', group })}
                onDelete={(group) => setDialog({ kind: 'delete', group })}
              />
            ))}
          </div>
        )}
      </Main>

      {/* Dialogs */}
      <GroupFormDialog
        open={dialog.kind === 'create' || dialog.kind === 'edit'}
        onOpenChange={(v) => !v && close()}
        group={dialog.kind === 'edit' ? dialog.group : undefined}
        onSuccess={close}
      />

      {dialog.kind === 'accounts' && (
        <GroupAccountsDialog
          open
          onOpenChange={(v) => !v && close()}
          group={dialog.group}
          onSuccess={close}
        />
      )}

      {dialog.kind === 'delete' && (
        <DeleteGroupDialog
          open
          onOpenChange={(v) => !v && close()}
          group={dialog.group}
          onSuccess={close}
        />
      )}
    </>
  )
}

function LoadingSkeleton() {
  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className='h-44 rounded-lg' />
      ))}
    </div>
  )
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className='flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center'>
      <FolderOpen className='mb-3 size-10 text-muted-foreground' />
      <p className='mb-1 font-medium'>Chưa có nhóm nào</p>
      <p className='mb-4 text-sm text-muted-foreground'>
        Tạo nhóm đầu tiên để bắt đầu phân chia crawler.
      </p>
      <Button onClick={onCreateClick}>
        <Plus className='me-2 size-4' />
        Tạo nhóm
      </Button>
    </div>
  )
}
