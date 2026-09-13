/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string
  readonly PUBLIC_AMPHON_STORE_API?: string
  readonly PUBLIC_LINE_URL?: string
  readonly PUBLIC_PHONE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
