/**
 * Creators page (simplified) — only global category filter config for crawler.
 * All search/track/profile-job logic removed (moved to auto-crawler flow).
 * Route: /creators
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { appSettingsApi, tiktokAccountApi } from '@/lib/api-endpoints'
import { handleServerError } from '@/lib/handle-server-error'
import {
  CategoryFilter,
  type CategorySelection,
} from '@/features/creators/category-filter'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

export function CreatorsPage() {
  const qc = useQueryClient()
  // User-override for category selection; null = fall back to server value
  const [localCategories, setLocalCategories] =
    useState<CategorySelection | null>(null)

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: appSettingsApi.get,
    staleTime: 30_000,
  })

  // Derive categories: use local override if set, otherwise use server value
  const categories: CategorySelection = localCategories ?? settings?.categoryList ?? []

  const { data: accounts } = useQuery({
    queryKey: ['tiktok-accounts'],
    queryFn: tiktokAccountApi.list,
    staleTime: 60_000,
  })

  // Categories là TikTok-global theo shop-region nên không gắn account cụ thể.
  // Backend tự chọn account còn sống + failover; FE chỉ gate khi có ≥1 account
  // khả dụng (flag != false) để tránh gọi chắc-chắn-fail khi DB trống.
  const usableAcc = (accounts ?? []).find(
    (a) => a.active !== false && a.cookieAlive !== false,
  )

  const { data: mpOptions, isLoading: optionsLoading } = useQuery({
    queryKey: ['marketplace-options', usableAcc?.shopRegion],
    queryFn: () => tiktokAccountApi.marketplaceOptions(usableAcc?.shopRegion),
    enabled: !!usableAcc,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const saveMutation = useMutation({
    mutationFn: () => appSettingsApi.update({ categoryList: categories }),
    onSuccess: () => {
      toast.success('Đã lưu danh mục cho crawler')
      void qc.invalidateQueries({ queryKey: ['app-settings'] })
    },
    onError: handleServerError,
  })

  const preview =
    categories.length === 0
      ? 'Crawler sẽ cào tất cả creator (không lọc danh mục).'
      : `Crawler sẽ cào creator thuộc ${categories.length} danh mục đã chọn.`

  return (
    <>
      <Header fixed>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold tracking-tight'>Creators</h1>
          <p className='text-sm text-muted-foreground'>
            Cấu hình danh mục sản phẩm cho crawler. Áp dụng cho tất cả TikTok
            account.
          </p>
        </div>

        <div className='max-w-2xl space-y-4'>
          {!usableAcc && !optionsLoading && (
            <Card>
              <CardContent className='p-4 text-sm text-muted-foreground'>
                Chưa có TikTok Account còn dùng được. Vào trang{' '}
                <strong>TikTok Accounts</strong> để thêm hoặc cập nhật cookie.
              </CardContent>
            </Card>
          )}

          {settingsLoading ? (
            <Skeleton className='h-10 w-48' />
          ) : (
            <div className='flex flex-wrap items-center gap-3'>
              <CategoryFilter
                options={mpOptions?.category}
                loading={optionsLoading}
                value={categories}
                onChange={setLocalCategories}
              />
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending && (
                  <Loader2 className='me-2 size-4 animate-spin' />
                )}
                Lưu
              </Button>
            </div>
          )}

          <p className='text-sm text-muted-foreground'>{preview}</p>
        </div>
      </Main>
    </>
  )
}
