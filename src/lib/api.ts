import { prisma } from '@/lib/prisma'
import { ExpenseFormValues, GroupFormValues } from '@/lib/schemas'
import {
  ActivityType,
  Expense,
  RecurrenceRule,
  RecurringExpenseLink,
} from '@prisma/client'
import { nanoid } from 'nanoid'

export function randomId() {
  return nanoid()
}

export async function createGroup(groupFormValues: GroupFormValues) {
  return prisma.group.create({
    data: {
      id: randomId(),
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      participants: {
        createMany: {
          data: groupFormValues.participants.map(({ name }) => ({
            id: randomId(),
            name,
          })),
        },
      },
    },
    include: { participants: true },
  })
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
): Promise<Expense> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  const expenseId = randomId()
  await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isCreateRecurrence =
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE
  const recurringExpenseLinkPayload = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  return prisma.expense.create({
    data: {
      id: expenseId,
      groupId,
      expenseDate: expenseFormValues.expenseDate,
      categoryId: expenseFormValues.category,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      paidById: expenseFormValues.paidBy,
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      recurringExpenseLink: {
        ...(isCreateRecurrence
          ? {
              create: recurringExpenseLinkPayload,
            }
          : {}),
      },
      paidFor: {
        createMany: {
          data: expenseFormValues.paidFor.map((paidFor) => ({
            participantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        },
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        createMany: {
          data: expenseFormValues.documents.map((doc) => ({
            id: randomId(),
            url: doc.url,
            width: doc.width,
            height: doc.height,
          })),
        },
      },
      notes: expenseFormValues.notes,
    },
  })
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  const existingExpense = await getExpense(groupId, expenseId)
  await logActivity(groupId, ActivityType.DELETE_EXPENSE, {
    participantId,
    expenseId,
    data: existingExpense?.title,
  })

  await prisma.expense.delete({
    where: { id: expenseId },
    include: { paidFor: true, paidBy: true },
  })
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        e.paidBy.id,
        ...e.paidFor.map((pf) => pf.participant.id),
      ]),
    ),
  )
}

export async function getGroups(groupIds: string[]) {
  return (
    await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: { _count: { select: { participants: true } } },
    })
  ).map((group) => ({
    ...group,
    createdAt: group.createdAt.toISOString(),
  }))
}

/**
 * Every group in the database, with the counts and totals the ops view shows.
 *
 * Uses three constant-count queries rather than per-group lookups. Note this
 * deliberately does not go through `getGroupExpenses`, which calls
 * `createRecurringExpenses` and therefore writes to the database — a listing
 * must not mutate.
 */
export async function getAllGroupsWithStats({ take = 500 } = {}) {
  // Fetching one extra row detects truncation without a second count query.
  const found = await prisma.group.findMany({
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    include: { _count: { select: { participants: true, expenses: true } } },
  })

  const truncated = found.length > take
  const groups = truncated ? found.slice(0, take) : found
  const groupIds = groups.map((group) => group.id)

  if (groupIds.length === 0) return { groups: [], truncated }

  const [expenseStats, activityStats] = await Promise.all([
    // Grouping by isReimbursement lets one query serve both the spending total
    // (reimbursements excluded, matching getTotalGroupSpending) and the date of
    // the most recent expense (all rows).
    prisma.expense.groupBy({
      by: ['groupId', 'isReimbursement'],
      where: { groupId: { in: groupIds } },
      _sum: { amount: true },
      _max: { expenseDate: true },
    }),
    // Group has no updatedAt, so the activity log is the only record of when a
    // group was last touched.
    prisma.activity.groupBy({
      by: ['groupId'],
      where: { groupId: { in: groupIds } },
      _max: { time: true },
    }),
  ])

  const totals = new Map<string, number>()
  const lastExpenseDates = new Map<string, Date>()
  for (const row of expenseStats) {
    if (!row.isReimbursement) {
      totals.set(
        row.groupId,
        (totals.get(row.groupId) ?? 0) + (row._sum.amount ?? 0),
      )
    }
    const date = row._max.expenseDate
    const known = lastExpenseDates.get(row.groupId)
    if (date && (!known || date > known))
      lastExpenseDates.set(row.groupId, date)
  }

  const lastActivityDates = new Map(
    activityStats.flatMap((row) =>
      row._max.time ? [[row.groupId, row._max.time]] : [],
    ),
  )

  return {
    truncated,
    groups: groups.map((group) => {
      const candidates = [
        group.createdAt,
        lastExpenseDates.get(group.id),
        lastActivityDates.get(group.id),
      ].filter((date): date is Date => date !== undefined)

      return {
        ...group,
        totalSpending: totals.get(group.id) ?? 0,
        lastActivityAt: new Date(
          Math.max(...candidates.map((d) => d.getTime())),
        ),
      }
    }),
  }
}

/**
 * Deletes a group and everything belonging to it.
 *
 * Participants, expenses, shares, activities and recurring expense links are
 * removed by database cascades. Expense documents are not: their foreign key is
 * ON DELETE SET NULL (see migration 20240128193431_update_documents), so the
 * group -> expense cascade would leave unreachable document rows behind. They
 * are deleted explicitly, in the same transaction.
 *
 * Note the S3 objects those documents point at are not removed.
 */
export async function deleteGroup(groupId: string) {
  return prisma.$transaction(async (tx) => {
    const { count: documents } = await tx.expenseDocument.deleteMany({
      where: { Expense: { is: { groupId } } },
    })
    await tx.group.delete({ where: { id: groupId } })
    return { documents }
  })
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  participantId?: string,
) {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  await logActivity(groupId, ActivityType.UPDATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isDeleteRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule === RecurrenceRule.NONE &&
    // Delete the existing RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null

  const isUpdateRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== expenseFormValues.recurrenceRule &&
    // Update the exisiting RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null
  const isCreateRecurrenceExpenseLink =
    existingExpense.recurrenceRule === RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE &&
    // Create a new RecurrenceExpenseLink only if one does not already exist for the expense
    existingExpense.recurringExpenseLink === null

  const newRecurringExpenseLink = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  const updatedRecurrenceExpenseLinkNextExpenseDate = calculateNextDate(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    existingExpense.expenseDate,
  )

  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      expenseDate: expenseFormValues.expenseDate,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      categoryId: expenseFormValues.category,
      paidById: expenseFormValues.paidBy,
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      paidFor: {
        create: expenseFormValues.paidFor
          .filter(
            (p) =>
              !existingExpense.paidFor.some(
                (pp) => pp.participantId === p.participant,
              ),
          )
          .map((paidFor) => ({
            participantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        update: expenseFormValues.paidFor.map((paidFor) => ({
          where: {
            expenseId_participantId: {
              expenseId,
              participantId: paidFor.participant,
            },
          },
          data: {
            shares: paidFor.shares,
          },
        })),
        deleteMany: existingExpense.paidFor.filter(
          (paidFor) =>
            !expenseFormValues.paidFor.some(
              (pf) => pf.participant === paidFor.participantId,
            ),
        ),
      },
      recurringExpenseLink: {
        ...(isCreateRecurrenceExpenseLink
          ? {
              create: newRecurringExpenseLink,
            }
          : {}),
        ...(isUpdateRecurrenceExpenseLink
          ? {
              update: {
                nextExpenseDate: updatedRecurrenceExpenseLinkNextExpenseDate,
              },
            }
          : {}),
        delete: isDeleteRecurrenceExpenseLink,
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        connectOrCreate: expenseFormValues.documents.map((doc) => ({
          create: doc,
          where: { id: doc.id },
        })),
        deleteMany: existingExpense.documents
          .filter(
            (existingDoc) =>
              !expenseFormValues.documents.some(
                (doc) => doc.id === existingDoc.id,
              ),
          )
          .map((doc) => ({
            id: doc.id,
          })),
      },
      notes: expenseFormValues.notes,
    },
  })
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  const existingGroup = await getGroup(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')

  await logActivity(groupId, ActivityType.UPDATE_GROUP, { participantId })

  return prisma.group.update({
    where: { id: groupId },
    data: {
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      participants: {
        deleteMany: existingGroup.participants.filter(
          (p) => !groupFormValues.participants.some((p2) => p2.id === p.id),
        ),
        updateMany: groupFormValues.participants
          .filter((participant) => participant.id !== undefined)
          .map((participant) => ({
            where: { id: participant.id },
            data: {
              name: participant.name,
            },
          })),
        createMany: {
          data: groupFormValues.participants
            .filter((participant) => participant.id === undefined)
            .map((participant) => ({
              id: randomId(),
              name: participant.name,
            })),
        },
      },
    },
  })
}

export async function getGroup(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: { participants: true },
  })
}

export async function getCategories() {
  return prisma.category.findMany()
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  await createRecurringExpenses()

  return prisma.expense.findMany({
    select: {
      amount: true,
      category: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      paidBy: { select: { id: true, name: true } },
      paidFor: {
        select: {
          participant: { select: { id: true, name: true } },
          shares: true,
        },
      },
      splitMode: true,
      recurrenceRule: true,
      title: true,
      _count: { select: { documents: true } },
    },
    where: {
      groupId,
      title: options?.filter
        ? { contains: options.filter, mode: 'insensitive' }
        : undefined,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    skip: options && options.offset,
    take: options && options.length,
  })
}

export async function getGroupExpenseCount(groupId: string) {
  return prisma.expense.count({ where: { groupId } })
}

export async function getExpense(groupId: string, expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      paidBy: true,
      paidFor: true,
      category: true,
      documents: true,
      recurringExpenseLink: true,
    },
  })
}

export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
) {
  const activities = await prisma.activity.findMany({
    where: { groupId },
    orderBy: [{ time: 'desc' }],
    skip: options?.offset,
    take: options?.length,
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter(Boolean)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      id: { in: expenseIds },
    },
  })

  return activities.map((activity) => ({
    ...activity,
    expense:
      activity.expenseId !== null
        ? expenses.find((expense) => expense.id === activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  return prisma.activity.create({
    data: {
      id: randomId(),
      groupId,
      activityType,
      ...extra,
    },
  })
}

async function createRecurringExpenses() {
  const localDate = new Date() // Current local date
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      // More precision beyond date is required to ensure that recurring Expenses are created within <most precises unit> of when expected
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  const recurringExpenseLinksWithExpensesToCreate =
    await prisma.recurringExpenseLink.findMany({
      where: {
        nextExpenseCreatedAt: null,
        nextExpenseDate: {
          lte: utcDateFromLocal,
        },
      },
      include: {
        currentFrameExpense: {
          include: {
            paidBy: true,
            paidFor: true,
            category: true,
            documents: true,
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id

    while (newExpenseDate < utcDateFromLocal) {
      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()

      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const {
        category,
        paidBy,
        paidFor,
        documents,
        ...destructeredCurrentExpenseRecord
      } = currentExpenseRecord

      // Use a transacton to ensure that the only one expense is created for the RecurringExpenseLink
      // just in case two clients are processing the same RecurringExpenseLink at the same time
      const newExpense = await prisma
        .$transaction(async (transaction) => {
          const newExpense = await transaction.expense.create({
            data: {
              ...destructeredCurrentExpenseRecord,
              categoryId: currentExpenseRecord.categoryId,
              paidById: currentExpenseRecord.paidById,
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    participantId: paidFor.participantId,
                    shares: paidFor.shares,
                  })),
                },
              },
              documents: {
                connect: currentExpenseRecord.documents.map(
                  (documentRecord) => ({
                    id: documentRecord.id,
                  }),
                ),
              },
              id: newExpenseId,
              expenseDate: newExpenseDate,
              recurringExpenseLink: {
                create: {
                  groupId: currentExpenseRecord.groupId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                },
              },
            },
            // Ensure that the same information is available on the returned record that was created
            include: {
              paidFor: true,
              documents: true,
              category: true,
              paidBy: true,
            },
          })

          // Mark the RecurringExpenseLink as being "completed" since the new Expense was created
          // if an expense hasn't been created for this RecurringExpenseLink yet
          await transaction.recurringExpenseLink.update({
            where: {
              id: currentReccuringExpenseLinkId,
              nextExpenseCreatedAt: null,
            },
            data: {
              nextExpenseCreatedAt: newExpense.createdAt,
            },
          })

          return newExpense
        })
        .catch(() => {
          console.error(
            'Failed to created recurringExpense for expenseId: %s',
            currentExpenseRecord.id,
          )
          return null
        })

      // If the new expense failed to be created, break out of the while-loop
      if (newExpense === null) break

      // Set the values for the next iteration of the for-loop in case multiple recurring Expenses need to be created
      currentExpenseRecord = newExpense
      currentReccuringExpenseLinkId = newRecurringExpenseLinkId
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }
}

function createPayloadForNewRecurringExpenseLink(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
  groupId: String,
): RecurringExpenseLink {
  const nextExpenseDate = calculateNextDate(
    recurrenceRule,
    priorDateToNextRecurrence,
  )

  const recurringExpenseLinkId = randomId()
  const recurringExpenseLinkPayload = {
    id: recurringExpenseLinkId,
    groupId: groupId,
    nextExpenseDate: nextExpenseDate,
  }

  return recurringExpenseLinkPayload as RecurringExpenseLink
}

// TODO: Modify this function to use a more comprehensive recurrence Rule library like rrule (https://github.com/jkbrzt/rrule)
//
// Current limitations:
// - If a date is intended to be repeated monthly on the 29th, 30th or 31st, it will change to repeating on the smallest
// date that the reccurence has encountered. Ex. If a recurrence is created for Jan 31st on 2025, the recurring expense
// will be created for Feb 28th, March 28, etc. until it is cancelled or fixed
function calculateNextDate(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
): Date {
  const nextDate = new Date(priorDateToNextRecurrence)
  switch (recurrenceRule) {
    case RecurrenceRule.DAILY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      break
    case RecurrenceRule.WEEKLY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 7)
      break
    case RecurrenceRule.MONTHLY:
      const nextYear = nextDate.getUTCFullYear()
      const nextMonth = nextDate.getUTCMonth() + 1
      let nextDay = nextDate.getUTCDate()

      // Reduce the next day until it is within the direct next month
      while (!isDateInNextMonth(nextYear, nextMonth, nextDay)) {
        nextDay -= 1
      }
      nextDate.setUTCMonth(nextMonth, nextDay)
      break
  }

  return nextDate
}

function isDateInNextMonth(
  utcYear: number,
  utcMonth: number,
  utcDate: number,
): Boolean {
  const testDate = new Date(Date.UTC(utcYear, utcMonth, utcDate))

  // We're not concerned if the year or month changes. We only want to make sure that the date is our target date
  if (testDate.getUTCDate() !== utcDate) {
    return false
  }

  return true
}
