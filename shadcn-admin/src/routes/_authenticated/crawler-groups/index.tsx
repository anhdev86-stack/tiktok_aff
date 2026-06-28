import { createFileRoute } from '@tanstack/react-router'
import { CrawlerGroupsPage } from '@/features/crawler-groups'

export const Route = createFileRoute('/_authenticated/crawler-groups/')({
  component: CrawlerGroupsPage,
})
