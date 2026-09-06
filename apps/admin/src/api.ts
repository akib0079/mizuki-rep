/** Thin fetch wrapper. Every call carries the admin session cookie and surfaces the API's own message. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (response.status === 204) return undefined as T

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    /*
     * A session that has ended is not a per-page problem, so it is not handled per page.
     *
     * Without this, an expired cookie shows up as whatever each screen does with a failed
     * request — an error card here, an endless skeleton there — and the studio is left guessing
     * why the console has stopped working when the answer is simply "sign in again". One event,
     * announced once, and the shell takes them back to sign-in.
     */
    if (response.status === 401 && !path.includes('/auth/admin/login')) {
      window.dispatchEvent(new CustomEvent('mizuki:session-ended'))
    }

    const error = body?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.details,
    )
  }

  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// --- Shapes the console works with ------------------------------------------

export interface AdminSession {
  id: string
  courseTypeId: string
  courseName: string
  colour: string
  title: string
  startAt: string
  endAt: string
  dateKey: string
  capacity: number
  heldBack: number
  seatsTaken: number
  seatsLeft: number
  overCapacity: boolean
  status: 'scheduled' | 'cancelled'
  isRecurring: boolean
  breaks: { start: string; end: string; label: string }[]
  notes: string
}

export interface RosterEntry {
  bookingId: string
  studentId: string
  /** Who is attending — the attendee's name when a booking was made for someone else. */
  name: string
  /** Set only when the attendee is not the account holder: who made the booking. */
  bookedBy: string
  email: string
  phone: string
  status: string
  source: string
  usedPackage: boolean
  capacityOverridden: boolean
  notes: string
  bookedAt: string
}

export interface Course {
  id: string
  name: string
  slug: string
  colour: string
  bookingMode: 'package' | 'paid' | 'free'
  rescheduleCutoffHours: number
  defaultCapacity: number
  defaultDurationMins: number
  /** Shop products that sell a place on this course. Empty means it cannot be bought yet. */
  wooProductIds: number[]
  /** True when a paid place waits for the studio to check the payment before it is confirmed. */
  requiresManualConfirmation: boolean
  active: boolean

  /* What a student reads behind "Learn more" on the booking page. All optional. */
  description: string
  suitableFor: string
  whatYouLearn: string
  whatToBring: string
  whatIsProvided: string
  priceNote: string
  imageUrl: string
}

export interface ClosedDate {
  id: string
  startDate: string
  endDate: string
  reason: string
}

export interface AwayPreview {
  days: number
  sessionCount: number
  affectedStudentCount: number
  sessions: {
    id: string
    dateKey: string
    title: string
    startAt: string
    bookedCount: number
    students: { name: string; email: string }[]
  }[]
}

export interface StudentSummary {
  id: string
  /** Short spoken label, e.g. MZ-0042 — what tells two students with the same name apart. */
  reference: string
  name: string
  email: string
  phone: string
  /** ISO country code when the number is not Singaporean; empty otherwise. */
  phoneCountry: string
  sessionsRemaining: number
}

export interface PackageSummary {
  id: string
  courseTypeId: string
  courseName: string
  totalSessions: number
  usedSessions: number
  remaining: number
  /** Both ends of the course period; either may be unset. */
  startsAt: string | null
  expiresAt: string | null
  status: string
}

export interface EmailTemplate {
  key: string
  label: string
  description: string
  variables: string[]
  subject: string
  bodyHtml: string
  bodyText: string
  isCustomised: boolean
  /**
   * False when this wording predates the current studio design.
   *
   * Only ever false for an email the studio wrote themselves: a deploy refreshes the shipped
   * wording but never touches theirs, so without saying so, one email in fifteen quietly keeps
   * the old colours and nobody knows which.
   */
  brandingIsCurrent: boolean
}
