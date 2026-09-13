import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'

export default defineConfig({
  site: 'https://shop.amphon.co.th',
  output: 'server',
  trailingSlash: 'always',
  session: false,
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
})
