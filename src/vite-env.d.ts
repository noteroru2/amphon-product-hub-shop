/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_R2_UPLOAD_API: string
  readonly VITE_ALLOW_SIGNUP: string
  readonly VITE_PUBLIC_APP_URL: string
  readonly VITE_SALES_SITE_URL: string
  readonly VITE_FACEBOOK_MARKETPLACE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
