import { env } from '@/lib/env'
import { MetadataRoute } from 'next'

/** Resolved per request, for the same reason as robots.ts. */
export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: env.NEXT_PUBLIC_BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 1,
    },
  ]
}
