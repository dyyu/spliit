/**
 * Credential checking for the ops view, shared by `src/proxy.ts` and the delete
 * server action.
 *
 * This module deliberately does not import `@/lib/env`. That module parses the
 * entire environment eagerly and requires the POSTGRES_* URLs, which would pull
 * zod and database configuration into the proxy bundle and make these functions
 * untestable in isolation.
 */

/**
 * The ops view is disabled unless a password is configured. Blank and
 * whitespace-only values count as unset, so an empty variable cannot
 * accidentally enable a blank password.
 */
export function getOpsPassword(): string | undefined {
  const password = process.env.OPS_PASSWORD?.trim()
  return password ? password : undefined
}

/**
 * Compares two strings without leaking their common prefix length through
 * timing. Written as a plain XOR loop over code units rather than
 * `node:crypto.timingSafeEqual` so the module has no runtime-specific imports.
 */
function equalsConstantTime(a: string, b: string): boolean {
  let difference = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    // charCodeAt returns NaN past the end; `|| 0` keeps the XOR well defined.
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return difference === 0
}

function decodeBase64(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Validates an HTTP Basic `Authorization` header against the configured
 * password. The username is ignored — there is only one credential.
 */
export function isOpsAuthorized(
  authorization: string | null | undefined,
  password: string,
): boolean {
  if (!authorization || !password) return false

  const match = /^Basic\s+(\S+)$/i.exec(authorization.trim())
  if (!match) return false

  let decoded: string
  try {
    decoded = decodeBase64(match[1])
  } catch {
    return false
  }

  // Split on the first colon only: the password may itself contain colons.
  const separator = decoded.indexOf(':')
  if (separator === -1) return false

  return equalsConstantTime(decoded.slice(separator + 1), password)
}
