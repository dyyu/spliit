import { env } from '@/lib/env'
import { MetadataRoute } from 'next'

/**
 * Resolved per request rather than at build time. The base URL comes from
 * VERCEL_PROJECT_PRODUCTION_URL, which Vercel injects into the running function
 * but which does not exist on the CI runner this project builds on — so
 * prerendering this route would bake in the localhost fallback.
 */
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/groups/', '/ops'],
    },
    sitemap: `${env.NEXT_PUBLIC_BASE_URL}/sitemap.xml`,
  }
}
