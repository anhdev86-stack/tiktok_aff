import { create } from 'zustand'

/**
 * Khi BE trả 409 `COOKIE_EXPIRED`, axios interceptor (`handleServerError`)
 * push target vào store thay vì toast. Dialog ở root layout subscribe và
 * yêu cầu user dán cookie mới — sau khi check ok mới close.
 */
export interface CookieExpiredTarget {
  accountId: string
  accountName?: string
  message?: string
  cookieCheckedAt?: string
}

interface CookiePromptState {
  target: CookieExpiredTarget | null
  open: (target: CookieExpiredTarget) => void
  close: () => void
}

export const useCookiePromptStore = create<CookiePromptState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
