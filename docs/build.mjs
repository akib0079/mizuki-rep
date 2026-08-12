import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Inline every screenshot as a data URI so the handbook is one file the client can email, keep in
 * a folder, or open with no connection. A folder of loose images beside an HTML file is a document
 * that arrives broken the first time somebody forwards it.
 */

// fileURLToPath, not .pathname — the checkout lives in a folder with a space in its name, and
// .pathname hands back "Mizuki%20Booking", which no filesystem call will open.
const DIR = fileURLToPath(new URL('.', import.meta.url))
const SRC = `${DIR}handbook.src.html`

/*
 * The published page needs a real document head — without the viewport line a phone renders it at
 * 980px and shrinks the whole thing to unreadable.
 */
const OUT = `${DIR}index.html`

/** Alt text, because a screenshot with no description is invisible to anyone using a screen reader. */
const ALT = {
  '01-signin': 'The sign-in page: email and password fields, a Sign in button, and a "Forgot your password?" link',
  '02-dashboard': 'The dashboard: a panel listing things that need attention today, four summary figures, today’s classes, a chart of how full the week is, and the next classes',
  '03-calendar': 'The calendar in month view, showing each class as a line with its start time, name and how full it is, with a colour key for each course along the bottom',
  '04-class-drawer': 'A class panel showing booked, on sale, held back and class size, plus and minus controls for class size and held-back places, the list of who is coming, and a Cancel class button',
  '05-students': 'The students list: name with reference number, contact details, sessions left, and an Open button on each row',
  '06-student-drawer': 'A student panel with Overview, Bookings, Packages and Details tabs, showing classes booked, attendance, courses taken and next classes',
  '07-payments': 'The payments page: two people waiting, each with their class, contact details and whether they have paid, with Confirm place and No payment buttons',
  '08-notifications': 'The notifications panel, headed by a red strip for payments to check, then one line per booking with the class, date and places left',
  '09-emails': 'The emails page: the list of messages on the left, the subject and wording in the middle, and a live preview of what the student receives on the right',
  '10-team': 'The team page: the list of admins with their status and a Reset password link, fields to add a new admin, and the list of extra addresses booking alerts go to',
  '11-settings': 'The settings page: one row per course with how it is booked, its shop product, whether places are confirmed by hand, notice to change, and default class size',
  '12-closed': 'The closed dates page: From and To date fields, a reason field, and buttons to check what the closure affects or close the days',
  '13-connected': 'The connected services panel: a banner confirming email is working, the send-from and reply-to addresses, the Resend key and Telegram settings, phone alerts and security options',
  '14-email-confirmation': 'A booking confirmation email showing the class name, date, time, sessions remaining, the deadline to change it, and a View my bookings button',
  '15-email-admin': 'A new-booking alert email showing who booked, the class, their email and phone, how many places are now taken, and an Open the class button',
  '16-email-pending': 'A place-reserved email explaining the place is held while payment is arranged',
  '17-email-reminder': 'A class reminder email showing the class, date, time and studio address',
}

let html = readFileSync(SRC, 'utf8')
let bytes = 0

html = html.replace(/\{\{IMG:([\w-]+)\}\}/g, (_m, name) => {
  const file = `${DIR}screenshots/${name}.jpg`
  const b64 = readFileSync(file).toString('base64')
  bytes += statSync(file).size

  const alt = ALT[name]
  if (!alt) throw new Error(`No alt text written for ${name}`)

  return `<img src="data:image/jpeg;base64,${b64}" alt="${alt}" loading="lazy" />`
})

const left = html.match(/\{\{IMG:[\w-]+\}\}/g)
if (left) throw new Error(`Unreplaced placeholders: ${left.join(', ')}`)

// Everything up to and including </style> belongs in the head; the rest is the body.
const split = html.indexOf('</style>') + '</style>'.length
if (split < 10) throw new Error('Could not find the stylesheet to split on')

const head = html.slice(0, split).trim()
const body = html.slice(split).trim()

const standalone = `<!doctype html>
<html lang="en-SG">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="How to run bookings, classes, students, payments and emails in the Mizuki Flora studio console." />
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='25' font-size='26'%3E%F0%9F%8C%B8%3C/text%3E%3C/svg%3E" />
${head}
</head>
<body>
${body}
</body>
</html>
`

writeFileSync(OUT, standalone)

console.log(`${OUT}`)
console.log(`  images  ${(bytes / 1e6).toFixed(2)} MB`)
console.log(`  page    ${(statSync(OUT).size / 1e6).toFixed(2)} MB`)
