/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL của backend API. Default `/api/v1` (cùng origin sau reverse proxy). */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
