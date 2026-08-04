import { getOpsPassword, isOpsAuthorized } from '@/lib/ops-auth'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * The ops view lists every group in the database, and a group ID is effectively
 * a full-access key to that group. It is therefore gated behind HTTP Basic auth
 * and disabled entirely unless OPS_PASSWORD is set.
 *
 * Both '/ops' and '/ops/:path*' are listed because the matcher documentation
 * describes `*` as "zero or more" but also describes patterns as anchored to the
 * start of the path. Which of those governs the bare path is not worth relying
 * on when the failure mode is an unauthenticated database listing.
 */
export const config = {
  matcher: ['/ops', '/ops/:path*'],
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Defensive: if matcher semantics ever shift, never apply this to other paths.
  if (pathname !== '/ops' && !pathname.startsWith('/ops/')) {
    return NextResponse.next()
  }

  const password = getOpsPassword()

  // Feature off. 404 rather than 401 so an unconfigured deployment does not
  // advertise that the route exists at all.
  if (!password) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  if (!isOpsAuthorized(request.headers.get('authorization'), password)) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        'WWW-Authenticate': 'Basic realm="Spliit ops", charset="UTF-8"',
      },
    })
  }

  // Never let a CDN or browser hold a copy of an authorized page.
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'no-store')
  return response
}
