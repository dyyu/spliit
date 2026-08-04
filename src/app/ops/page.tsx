import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getAllGroupsWithStats } from '@/lib/api'
import { formatCurrency, formatDate, getCurrencyFromGroup } from '@/lib/utils'
import { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import Link from 'next/link'
import { DeleteGroupButton } from './delete-group-button'

/**
 * Without this the page has no dynamic inputs, so it would be prerendered at
 * build time — baking a snapshot of every group into the deployment and serving
 * it without the proxy ever running.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ops',
  robots: { index: false, follow: false },
}

export default async function OpsPage() {
  const locale = await getLocale()
  const { groups, truncated } = await getAllGroupsWithStats()

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="font-bold text-2xl flex-1">
          All groups{' '}
          <span className="font-normal text-muted-foreground">
            ({groups.length})
          </span>
        </h1>
      </div>

      {truncated && (
        <Alert>
          <AlertTitle>Showing the most recent groups only</AlertTitle>
          <AlertDescription>
            There are more groups than this page displays. Only the newest{' '}
            {groups.length} are listed.
          </AlertDescription>
        </Alert>
      )}

      {groups.length === 0 ? (
        <p className="text-muted-foreground">No groups yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/groups/${group.id}`}
                      className="hover:underline"
                    >
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {group.id}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group._count.participants}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group._count.expenses}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {formatCurrency(
                      getCurrencyFromGroup(group),
                      group.totalSpending,
                      locale,
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(group.createdAt, locale, {
                      dateStyle: 'medium',
                    })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(group.lastActivityAt, locale, {
                      dateStyle: 'medium',
                    })}
                  </TableCell>
                  <TableCell>
                    <DeleteGroupButton
                      groupId={group.id}
                      groupName={group.name}
                      participantCount={group._count.participants}
                      expenseCount={group._count.expenses}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Totals exclude reimbursements and are shown in each group&apos;s own
        currency, so they are not comparable across rows.
      </p>
    </>
  )
}
