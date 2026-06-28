import { createFileRoute } from '@tanstack/react-router'
import { CrawlerPage } from '@/features/crawler'

export const Route = createFileRoute('/_authenticated/crawler/')({
  component: CrawlerPage,
})
