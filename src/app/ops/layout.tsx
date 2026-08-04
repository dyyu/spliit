import { PropsWithChildren, Suspense } from 'react'

/**
 * Mirrors the groups layout, but wider: this page is a dense table rather than
 * a reading column.
 */
export default function OpsLayout({ children }: PropsWithChildren<{}>) {
  return (
    <Suspense>
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 py-6 flex flex-col gap-6">
        {children}
      </main>
    </Suspense>
  )
}
