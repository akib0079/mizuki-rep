import type { PublicCalendarDay, PublicSession } from '@mizuki/shared'

/** How a student reaches the studio, shown wherever they might need to ask something. */
export interface StudioContact {
  phone: string
  email: string
}

/**
 * A course as the booking page sees it — the studio's own writing about what it is, alongside
 * the few rules the widget needs. Everything descriptive is optional: a course with none of it
 * shows no "Learn more" button rather than an empty panel.
 */
export interface PublicCourse {
  id: string
  name: string
  slug: string
  colour: string
  bookingMode: string
  rescheduleCutoffHours: number
  description: string
  suitableFor: string
  whatYouLearn: string
  whatToBring: string
  whatIsProvided: string
  priceNote: string
  imageUrl: string
}

/** True when there is enough written to be worth opening a panel for. */
export function hasCourseDetail(course: PublicCourse | undefined): boolean {
  if (!course) return false
  return Boolean(
    course.description?.trim() ||
      course.whatYouLearn?.trim() ||
      course.suitableFor?.trim() ||
      course.whatToBring?.trim() ||
      course.whatIsProvided?.trim() ||
      course.priceNote?.trim(),
  )
}

/**
 * The widget runs on the WordPress site and talks to the API on a different host, so every
 * request is explicitly cross-origin with credentials — that is what lets a signed-in student
 * see their own bookings from the shop's pages.
 */

let apiBase = ''

export function configureApi(base: string): void {
  apiBase = base.replace(/\/$/, '')
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch (cause) {
    /*
     * fetch() rejects with an opaque TypeError for network failures and, more often in practice,
     * for a blocked cross-origin response — browsers deliberately withhold the reason from the
     * page. The widget cannot tell the difference, so it says what it can and leaves a precise
     * hint in the console, where whoever is installing it will look.
     */
    console.error(
      `[mizuki-booking] Could not reach ${apiBase}${path}.\n` +
        `If the API is up and this page loads over https, the usual cause is that this site's ` +
        `address is missing from CORS_ORIGINS on the booking system.\n` +
        `This page's origin: ${window.location.origin}`,
      cause,
    )
    throw new ApiError(0, 'unreachable', 'We could not reach the booking system. Please refresh, or let us know if it keeps happening.')
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? 'Something went wrong. Please try again.',
    )
  }
  return body as T
}

export const widgetApi = {
  calendar: (params: { from?: string; to?: string; courseTypeId?: string } = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
    ).toString()
    return request<{ from: string; to: string; days: PublicCalendarDay[] }>(
      `/api/public/calendar${query ? `?${query}` : ''}`,
    )
  },

  courses: () => request<{ courses: PublicCourse[]; studio?: StudioContact }>('/api/public/courses'),

  alternatives: (sessionId: string) =>
    request<{ alternatives: PublicSession[] }>(`/api/public/sessions/${sessionId}/alternatives`),

  /*
   * Identity is optional here because a signed-in student must not send it: the server takes
   * who they are from their session and ignores the rest, so sending a name would only be a
   * chance for the two to disagree.
   */
  startBooking: (body: {
    sessionId: string
    email?: string
    name?: string
    phone?: string
    notes?: string
    marketingOptIn?: boolean
    attendeeName?: string
    /** Sent only after they have been shown a possible duplicate and said it is not them. */
    confirmedNewAccount?: boolean
  }) => request<StartBookingResult>('/api/bookings/start', { method: 'POST', body: JSON.stringify(body) }),

  myBookings: () => request<MyBookings>('/api/bookings/mine'),

  reschedule: (bookingId: string, toSessionId: string) =>
    request<unknown>('/api/bookings/reschedule', {
      method: 'POST',
      body: JSON.stringify({ bookingId, toSessionId }),
    }),

  cancel: (bookingId: string, reason = '') =>
    request<unknown>('/api/bookings/cancel', { method: 'POST', body: JSON.stringify({ bookingId, reason }) }),

  /** Hand a held place straight back when the student closes the box instead of paying. */
  releaseHold: (holdToken: string) =>
    request<{ ok: boolean }>('/api/bookings/release-hold', {
      method: 'POST',
      body: JSON.stringify({ holdToken }),
    }),

  /** The student's own profile — email is not editable, it is their sign-in identity. */
  updateMe: (body: { name: string; phone: string; marketingOptIn: boolean }) =>
    request<{ student: StudentProfile }>('/api/bookings/me', { method: 'PATCH', body: JSON.stringify(body) }),

  me: () => request<{ student: StudentProfile; packages: PackageRow[] }>('/api/auth/me'),

  /**
   * Ends the session on this device.
   *
   * A shared studio laptop, or a phone handed to a friend to show them a class, otherwise leaves
   * the next person looking at someone else's bookings and able to cancel them — the sign-in
   * link lasts ninety days, so "it will expire" is not an answer.
   */
  signOut: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  history: () => request<{ classes: PastClass[]; totals: { attended: number; total: number } }>('/api/bookings/history'),

  /** Absolute, because the browser downloads it directly rather than fetching it. */
  calendarUrl: (bookingId: string) => `${apiBase}/api/bookings/${bookingId}/calendar.ics`,

  requestMagicLink: (email: string, redirectTo?: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email, ...(redirectTo ? { redirectTo } : {}) }),
    }),
}

export type StartBookingResult =
  | { outcome: 'booked'; booking: { id: string; session: PublicSession }; packageRemaining: number | null }
  | { outcome: 'verify_email'; message: string }
  /** The address or number definitely belongs to an account — sign in rather than book blind. */
  | {
      outcome: 'sign_in_required'
      reason: 'email_known' | 'phone_known'
      certain: true
      email: string
      message: string
    }
  /** It looks like an account they already have, but we are guessing — so they get to decide. */
  | {
      outcome: 'possible_duplicate'
      reason: 'email_similar' | 'name_known'
      certain: false
      email: string
      name: string
      message: string
    }
  /**
   * The place is held while the studio arranges payment — a student on a course-package course
   * who does not have a package yet. Not a confirmation, but not a refusal either: they have a
   * seat, and the studio has been told to get in touch.
   */
  | { outcome: 'awaiting_confirmation'; booking: { id: string; session: PublicSession }; message: string }
  | {
      outcome: 'checkout_required'
      message: string
      bookingId: string
      studentId: string
      sessionId: string
      /** Proves this held place belongs to this visitor, and travels through the shop with them. */
      holdToken: string
      holdExpiresAt: string
      holdMinutes: number
      checkoutUrl: string
      wooProductIds: number[]
      shopUrl: string
    }

export interface MyBookingRow {
  id: string
  status: string
  session: PublicSession
  canReschedule: boolean
  rescheduleDeadline: string | null
  rescheduleBlockedReason: string | null
}

export interface PackageRow {
  id: string
  courseTypeId: string
  totalSessions: number
  usedSessions: number
  remaining: number
  expiresAt: string | null
  status: string
}

export interface StudentProfile {
  id: string
  name: string
  email: string
  phone: string
  marketingOptIn?: boolean
}

export interface PastClass {
  id: string
  status: string
  title: string
  courseName: string
  colour: string
  startAt: string
  endAt: string
  durationMins: number
}

export interface MyBookings {
  bookings: MyBookingRow[]
  packages: PackageRow[]
}
