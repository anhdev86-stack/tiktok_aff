import { createFileRoute } from '@tanstack/react-router'
import { ServiceAccountsPage } from '@/features/service-accounts'

export const Route = createFileRoute('/_authenticated/service-accounts/')({
  component: ServiceAccountsPage,
})
