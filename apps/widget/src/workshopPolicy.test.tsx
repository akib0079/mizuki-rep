import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WORKSHOP_POLICY, type BookingMode, type PublicSession } from '@mizuki/shared'
import { BookingDialog } from './BookingDialog.js'

function session(bookingMode: BookingMode): PublicSession {
  return {
    id: 'session-1',
    courseTypeId: 'course-1',
    courseName: bookingMode === 'paid' ? 'Seasonal Bouquet Workshop' : 'IFDA Course',
    colour: '#76846f',
    title: bookingMode === 'paid' ? 'Seasonal Bouquet Workshop' : 'IFDA Lesson',
    startAt: '2026-10-10T02:00:00.000Z',
    endAt: '2026-10-10T04:00:00.000Z',
    durationMins: 120,
    breaks: [],
    seatsLeft: 6,
    isFull: false,
    availability: 'available',
    bookingMode,
  }
}

function render(bookingMode: BookingMode): string {
  return renderToStaticMarkup(
    <BookingDialog session={session(bookingMode)} onClose={() => undefined} onBooked={() => undefined} />,
  )
}

describe('workshop policy before payment', () => {
  it('shows the complete policy in the paid workshop booking form', () => {
    expect(render('paid')).toContain(WORKSHOP_POLICY)
  })

  it('does not show the workshop policy for course package bookings', () => {
    expect(render('package')).not.toContain(WORKSHOP_POLICY)
  })
})
