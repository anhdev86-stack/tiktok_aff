import {
  Activity,
  Bug,
  Construction,
  FileX,
  FolderOpen,
  Key,
  LayoutDashboard,
  Lock,
  Monitor,
  Palette,
  ServerOff,
  Settings,
  ShieldCheck,
  ShoppingBag,
  UserSearch,
  UserX,
  Wrench,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'admin',
    email: 'admin@local',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'TikTok Affiliate Admin',
      logo: ShoppingBag,
      plan: 'Self-hosted',
    },
  ],
  navGroups: [
    {
      title: 'Operations',
      items: [
        { title: 'Dashboard', url: '/', icon: LayoutDashboard },
        { title: 'TikTok Accounts', url: '/tiktok-accounts', icon: ShoppingBag },
{ title: 'Creators', url: '/creators', icon: UserSearch },
        { title: 'Crawler', url: '/crawler', icon: Activity },
        { title: 'Crawler Groups', url: '/crawler-groups', icon: FolderOpen },
      ],
    },
    {
      title: 'Admin',
      items: [
        { title: 'Service Accounts', url: '/service-accounts', icon: Key },
        { title: 'Audit Logs', url: '/audit-logs', icon: ShieldCheck },
      ],
    },
    {
      title: 'Settings',
      items: [
        {
          title: 'Settings',
          icon: Settings,
          items: [
            { title: 'Account', url: '/settings/account', icon: Wrench },
            { title: 'Appearance', url: '/settings/appearance', icon: Palette },
            { title: 'Display', url: '/settings/display', icon: Monitor },
          ],
        },
        {
          title: 'Errors',
          icon: Bug,
          items: [
            { title: 'Unauthorized', url: '/errors/unauthorized', icon: Lock },
            { title: 'Forbidden', url: '/errors/forbidden', icon: UserX },
            { title: 'Not Found', url: '/errors/not-found', icon: FileX },
            {
              title: 'Internal Server Error',
              url: '/errors/internal-server-error',
              icon: ServerOff,
            },
            {
              title: 'Maintenance',
              url: '/errors/maintenance-error',
              icon: Construction,
            },
          ],
        },
      ],
    },
  ],
}
