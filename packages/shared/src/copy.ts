/** The workshop policy shown before payment and repeated in student emails. */
export const WORKSHOP_POLICY =
  workshopPolicy('+65 8821 9386')

export function workshopPolicy(phone: string): string {
  return `No refunds are available within 48 hours of the workshop. If you need to reschedule or have a question, please contact us on WhatsApp at ${phone}.`
}
