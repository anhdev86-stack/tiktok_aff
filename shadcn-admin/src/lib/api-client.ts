import axios, { type AxiosError, type AxiosInstance } from 'axios'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Base URL của backend API. Cấu hình qua `VITE_API_URL`. Khi build cho prod
 * thường set thành domain reverse-proxy mà nginx/caddy của Coolify expose ra
 * ngoài. Default fallback là `/api/v1` (cùng origin) — phù hợp khi FE+BE
 * cùng domain qua reverse proxy.
 */
const baseURL = import.meta.env.VITE_API_URL ?? '/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  // không gửi cookie cross-origin — auth qua Bearer token trong Authorization
  withCredentials: false,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Inject Authorization: Bearer <token> mỗi request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 401 handler nằm trong main.tsx (queryCache.onError) — interceptor chỉ
// passthrough lỗi để TanStack Query xử lý.
apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => Promise.reject(err)
)

/** Helper: GET → response data */
export async function get<T>(
  url: string,
  params?: Record<string, unknown> | object
): Promise<T> {
  const r = await apiClient.get<T>(url, { params })
  return r.data
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await apiClient.post<T>(url, body)
  return r.data
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const r = await apiClient.patch<T>(url, body)
  return r.data
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const r = await apiClient.put<T>(url, body)
  return r.data
}

export async function del<T>(url: string): Promise<T> {
  const r = await apiClient.delete<T>(url)
  return r.data
}
