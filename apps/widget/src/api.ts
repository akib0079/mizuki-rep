import type { PublicCalendarDay, PublicSession } from '@mizuki/shared'

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
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })

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

  courses: () =>
    request<{ courses: { id: string; name: string; slug: string; colour: string; bookingMode: string; rescheduleCutoffHours: number }[] }>(
      '/api/public/courses',
    ),

  alternatives: (sessionId: string) =>
    request<{ alternatives: PublicSession[] }>(`/api/public/sessions/${sessionId}/alternatives`),

  startBooking: (body: {
    sessionId: string
    email: string
    name: string
    phone?: string
    notes?: string
    marketingOptIn?: boolean
  }) => request<StartBookingResult>('/api/bookings/start', { method: 'POST', body: JSON.stringify(body) }),

  myBookings: () => request<MyBookings>('/api/bookings/mine'),

  reschedule: (bookingId: string, toSessionId: string) =>
    request<unknown>('/api/bookings/reschedule', {
      method: 'POST',
      body: JSON.stringify({ bookingId, toSessionId }),
    }),

  cancel: (bookingId: string, reason = '') =>
    request<unknown>('/api/bookings/cancel', { method: 'POST', body: JSON.stringify({ bookingId, reason }) }),

  requestMagicLink: (email: string, redirectTo?: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email, ...(redirectTo ? { redirectTo } : {}) }),
    }),
}

export type StartBookingResult =
  | { outcome: 'booked'; booking: { id: string; session: PublicSession }; packageRemaining: number | null }
  | { outcome: 'verify_email'; message: string }
  | {
      outcome: 'checkout_required'
      message: string
      studentId: string
      sessionId: string
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

export interface MyBookings {
  bookings: MyBookingRow[]
  packages: {
    id: string
    courseTypeId: string
    totalSessions: number
    usedSessions: number
    remaining: number
    expiresAt: string | null
    status: string
  }[]
}
