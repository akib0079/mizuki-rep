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
    productUrl: bookingMode === 'paid' ? 'https://mizuki.com.sg/product/workshop/' : '',
    priceText: bookingMode === 'paid' ? 'S$120.00' : '',
  }
}

function render(bookingMode: BookingMode): string {
  return renderToStaticMarkup(
    <BookingDialog session={session(bookingMode)} onClose={() => undefined} onBooked={() => undefined} />,
  )
}

describe('workshop policy before payment', () => {
  it('shows the complete policy in the paid workshop booking form', () => {
    const page = render('paid')
    expect(page).toContain(WORKSHOP_POLICY)
    expect(page).toContain('S$120.00 per participant')
    expect(page).toContain('Number of participants')
    expect(page).toContain('Continue to payment')
    expect(page).not.toContain('Choose a password')
  })

  it('does not show the workshop policy for course package bookings', () => {
    const page = render('package')
    expect(page).not.toContain(WORKSHOP_POLICY)
    expect(page).toContain('Choose a password')
  })
})
