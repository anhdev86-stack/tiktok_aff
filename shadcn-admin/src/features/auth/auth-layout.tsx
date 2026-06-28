import { ShieldCheck, Sparkles, TrendingUp } from 'lucide-react'
import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Layout 2 cột cho trang auth — pattern admin SaaS hiện đại:
 *  - Cột trái (lg:): brand + value props, gradient subtle, ẩn ở mobile.
 *  - Cột phải: form, full-width ở mobile, max-width trung tâm.
 * Bố cục dùng grid để bám đúng `min-h-svh` mà không gây overflow.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='grid min-h-svh w-full lg:grid-cols-2'>
      {/* Hero — chỉ hiện ở md+ */}
      <aside className='relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:bg-zinc-900 lg:p-10 lg:text-zinc-50'>
        {/* gradient blobs trang trí */}
        <div
          aria-hidden
          className='absolute -top-32 -left-32 h-96 w-96 rounded-full bg-gradient-to-br from-fuchsia-500/30 to-violet-500/10 blur-3xl'
        />
        <div
          aria-hidden
          className='absolute -right-40 -bottom-40 h-[28rem] w-[28rem] rounded-full bg-gradient-to-tr from-cyan-500/30 to-emerald-500/10 blur-3xl'
        />

        <div className='relative z-10 flex items-center gap-2'>
          <Logo className='size-7 text-zinc-50' />
          <span className='text-base font-semibold tracking-tight'>
            TikTok Affiliate Admin
          </span>
        </div>

        <div className='relative z-10 flex flex-col gap-6'>
          <h2 className='text-3xl leading-tight font-semibold tracking-tight xl:text-4xl'>
            Trung tâm điều hành Affiliate.
            <br />
            <span className='text-zinc-300'>Một dashboard, mọi shop.</span>
          </h2>
          <ul className='space-y-3 text-sm text-zinc-300'>
            <Feature
              icon={<TrendingUp className='size-4' />}
              text='Theo dõi creator, push số liệu thẳng vào Google Sheets.'
            />
            <Feature
              icon={<ShieldCheck className='size-4' />}
              text='Service Account & cookie mã hoá AES-256-GCM trước khi lưu DB.'
            />
            <Feature
              icon={<Sparkles className='size-4' />}
              text='Profile job realtime, audit log đầy đủ, rate-limit chống brute-force.'
            />
          </ul>
        </div>

        <p className='relative z-10 text-xs text-zinc-400'>
          © {new Date().getFullYear()} Self-hosted. Không index, không tracker.
        </p>
      </aside>

      {/* Form */}
      <main className='flex items-center justify-center p-6 sm:p-10'>
        <div className='flex w-full max-w-sm flex-col gap-6'>
          {/* Brand mobile-only — hero ẩn ở mobile nên cần fallback */}
          <div className='flex items-center justify-center gap-2 lg:hidden'>
            <Logo className='size-6' />
            <span className='text-base font-semibold tracking-tight'>
              TikTok Affiliate Admin
            </span>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

function Feature({
  icon,
  text,
}: {
  icon: React.ReactNode
  text: string
}) {
  return (
    <li className='flex items-start gap-3'>
      <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-50/10 text-zinc-50'>
        {icon}
      </span>
      <span>{text}</span>
    </li>
  )
}
