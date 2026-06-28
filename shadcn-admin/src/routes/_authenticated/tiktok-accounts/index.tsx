import { createFileRoute } from '@tanstack/react-router'
import { TiktokAccountsPage } from '@/features/tiktok-accounts'

export const Route = createFileRoute('/_authenticated/tiktok-accounts/')({
  component: TiktokAccountsPage,
})
