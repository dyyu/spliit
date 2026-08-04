'use server'

import { deleteGroup } from '@/lib/api'
import { getOpsPassword, isOpsAuthorized } from '@/lib/ops-auth'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

/**
 * Server functions are not separate routes: they are POSTs to the route they
 * are used from, so `src/proxy.ts` already covers this. The Next documentation
 * nonetheless warns that moving a server function to another route silently
 * removes that coverage, and asks that authorization be checked inside the
 * function itself. Both layers fail closed identically.
 */
export async function deleteGroupAction(groupId: string) {
  const password = getOpsPassword()
  if (!password) throw new Error('Not found')

  const authorization = (await headers()).get('authorization')
  if (!isOpsAuthorized(authorization, password)) {
    throw new Error('Unauthorized')
  }

  const result = await deleteGroup(groupId)
  revalidatePath('/ops')
  return result
}
