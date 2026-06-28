import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { useCookiePromptStore } from '@/stores/cookie-prompt-store'

/**
 * Backend Nest trả error theo format:
 *   { statusCode, error, message, timestamp }
 * `message` có thể là string hoặc string[] (validation errors).
 *
 * Trường hợp đặc biệt: 409 với `code === 'COOKIE_EXPIRED'` → push vào
 * cookie-prompt store để dialog cập nhật cookie tự bật, không toast.
 */
export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  if (error instanceof AxiosError && error.response?.status === 409) {
    const data = error.response.data as
      | {
          code?: string
          accountId?: string
          accountName?: string
          message?: string
          cookieCheckedAt?: string
        }
      | undefined
    if (data?.code === 'COOKIE_EXPIRED' && data.accountId) {
      useCookiePromptStore.getState().open({
        accountId: data.accountId,
        accountName: data.accountName,
        message: data.message,
        cookieCheckedAt: data.cookieCheckedAt,
      })
      return
    }
  }

  let errMsg = 'Something went wrong!'

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'No content.'
  }

  if (error instanceof AxiosError) {
    const data = error.response?.data as
      | { message?: unknown; error?: string; title?: string }
      | undefined
    if (data) {
      if (Array.isArray(data.message) && data.message.length > 0) {
        errMsg = data.message.map((m) => String(m)).join('\n')
      } else if (typeof data.message === 'string' && data.message.length > 0) {
        errMsg = data.message
      } else if (typeof data.title === 'string' && data.title.length > 0) {
        errMsg = data.title
      } else if (typeof data.error === 'string' && data.error.length > 0) {
        errMsg = data.error
      }
    }
  }

  toast.error(errMsg)
}
