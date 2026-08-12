import type { ReactNode } from 'react'
import { ApiError } from '../api.js'

/**
 * Loading and failure are different things, and a page has to say which.
 *
 * The pattern that caused this was `if (isLoading || !data) return <Skeleton />`. It looks
 * complete — it covers both the first render and the moment before data arrives — but on an
 * error `isLoading` goes false while `data` stays undefined, so the skeleton renders forever.
 * The studio sees a dashboard that never finishes loading, with nothing to click and nothing
 * saying what went wrong, and there is no way to tell that from a slow connection.
 */
export function QueryState({
  isLoading,
  error,
  data,
  skeleton,
  onRetry,
  children,
}: {
  isLoading: boolean
  error: unknown
  data: unknown
  skeleton: ReactNode
  onRetry?: () => void
  children: ReactNode
}) {
  if (error) return <QueryError error={error} onRetry={onRetry} />

  // Genuinely still waiting: no error, and nothing to show yet.
  if (isLoading || data === undefined) return <>{skeleton}</>

  return <>{children}</>
}

function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  /*
   * A session that has expired is not a failure the studio can act on by retrying — it means
   * signing in again, so say that rather than offering a button that will fail the same way.
   */
  const status = error instanceof ApiError ? error.status : undefined
  const expired = status === 401 || status === 403

  const message = expired
    ? 'Your session has ended. Sign in again to carry on.'
    : error instanceof Error && error.message
      ? error.message
      : 'Something went wrong loading this.'

  return (
    <div className="card query-error" role="alert">
      <h3>This did not load</h3>
      <p className="muted">{message}</p>

      <div className="row">
        {expired ? (
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Sign in again
          </button>
        ) : (
          onRetry && (
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
          )
        )}
      </div>

      {/* The status code is meaningless to the studio and the first thing anyone helping them
          will ask for, so it is present but quiet. */}
      {status !== undefined && <p className="small faint">Error {status}</p>}
    </div>
  )
}
