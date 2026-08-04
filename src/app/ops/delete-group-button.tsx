'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deleteGroupAction } from './actions'

type Props = {
  groupId: string
  groupName: string
  participantCount: number
  expenseCount: number
}

export function DeleteGroupButton({
  groupId,
  groupName,
  participantCount,
  expenseCount,
}: Props) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [isPending, startTransition] = useTransition()
  const { toast } = useToast()
  const router = useRouter()

  // The rows on this page look alike and the action is irreversible, so require
  // the name to be typed rather than relying on a single click.
  const confirmed = confirmation === groupName

  const onDelete = () => {
    startTransition(async () => {
      try {
        await deleteGroupAction(groupId)
        setOpen(false)
        setConfirmation('')
        toast({ title: `Deleted “${groupName}”` })
        router.refresh()
      } catch (error) {
        toast({
          title: 'Could not delete the group',
          description: error instanceof Error ? error.message : undefined,
          variant: 'destructive',
        })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirmation('')
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${groupName}`}
          title={`Delete ${groupName}`}
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{groupName}”?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                This permanently deletes {participantCount}{' '}
                {participantCount === 1 ? 'participant' : 'participants'},{' '}
                {expenseCount} {expenseCount === 1 ? 'expense' : 'expenses'},
                every split behind them, any attached documents, and the
                activity log. It cannot be undone.
              </p>
              <p>
                Type <span className="font-medium">{groupName}</span> to
                confirm.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={groupName}
          autoComplete="off"
        />
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={!confirmed || isPending}
          >
            {isPending ? 'Deleting…' : 'Delete group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
