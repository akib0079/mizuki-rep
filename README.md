# Mizuki Flora — Booking System

A class booking and studio-management system for [mizuki.com.sg](https://mizuki.com.sg).

The studio's WordPress site keeps doing what it already does — it sells workshops through
WooCommerce and it is where students land. This system owns everything WordPress cannot: which
classes run, how many places each has, who holds them, whose course sessions are being counted
down, and what gets emailed to whom.

## What it does

**For students** — a calendar of the next three months on the studio's own site. Click a date,
see every class that day with its time, length and places left, and book. Full classes are
marked. Their own page shows what they have booked, how long they have to change it, and how
many course sessions they have left.

**For the studio** — a calendar you can drag classes around on. Change a class size or hold
places back for chat bookings. Add someone by hand. Mark days closed and they vanish from the
booking calendar. Grant course sessions or extend an expiry. Reword any email.

**Automatically** — a confirmation the moment someone books, a reminder two days before, an
alert to the studio on every booking, and places held during checkout that go back on sale if
payment never completes.

**Through the shop** — buying a workshop confirms the place that was held while the student
paid. Buying a course package grants the sessions and emails the student that they can start
booking. Buying a set course like the Autumn Ikebana Course books all four of its mornings in
one go — and either secures every date or none, because a student on three days of a four-day
course has bought something that does not work.

## The rules it enforces

| Course | Booked with | Notice to change a booking |
|---|---|---|
| IFDA | Course package | 24 hours |
| Preserved Flower | Course package | 24 hours |
| Ikebana | Shop payment | 3 days |
| Fresh Flower | Shop payment | 3 days |
| Bouquet | Shop payment | 3 days |

A Saturday 10:00 Ikebana class therefore locks at Wednesday 10:00. Every value is editable in
the console — changing the policy is a setting, not a deploy.

**A class can never be oversold.** The check and the increment are one atomic database
operation, so two students clicking the last place at the same instant cannot both succeed. This
is covered by a test that fires twenty concurrent bookings at a five-place class.

That guarantee holds through every route to a seat: the website, the studio adding someone by
hand, a place held during checkout, and a shop callback arriving late. If payment lands after a
hold expired and the class has since filled, nobody is overbooked — the studio gets an urgent
alert to refund or offer another date.

## Layout

```
packages/shared    Booking rules and timezone maths, shared by API and both front ends
apps/api           Express + MongoDB. Models, seats, packages, calendar, auth, scheduled jobs
apps/admin         The studio console (React + FullCalendar)
apps/widget        The student booking widget, embedded into WordPress
wp-plugin          WordPress plugin: shortcodes + WooCommerce bridge
```

`packages/shared` matters more than its size suggests: the reschedule deadline and places-left
maths live there so the widget and the API compute them identically. The widget uses them to
decide what to grey out; the API re-runs them as the authority.

## Running it locally

```bash
npm install
```

Copy `apps/api/.env.example` to `apps/api/.env` and fill it in. You need a MongoDB connection
string — a free Atlas cluster works. Then:

```bash
npm run build -w @mizuki/shared && npm run seed
```

That loads the five courses, the weekly IFDA timetable and every weekend workshop through to
November. It is safe to run again.

```bash
npm run dev:api      # API on :4000
npm run dev:admin    # Studio console on :5173
npm run dev:widget   # Student widget on :5174
```

Create your sign-in, then open http://localhost:5173:

```bash
npm run create-admin
```

## Tests

```bash
npm test
```

Runs against a real MongoDB (started in-memory as a replica set), not a mock — the concurrency
guarantees are the point, and a mocked driver would happily pretend they hold.

## Deploying

**API** — Hostinger hPanel → Websites → Add Website → Node.js, on a subdomain such as
`api.mizuki.com.sg`. Deploy from GitHub, set the environment variables from `.env.example`, and
run `npm run seed` and `npm run create-admin` once.

**Scheduled work** — one hPanel cron entry, every five minutes:

```bash
curl -fsS -X POST https://api.mizuki.com.sg/api/jobs/tick -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

This is what sends reminders, releases unpaid holds, keeps the three-month calendar filled and
posts the morning digest. Each job is safe to run repeatedly.

**WordPress** — build the plugin and upload it:

```bash
npm run package:wp
```

Then in wp-admin: Plugins → Add New → Upload, activate, and under Settings → Mizuki Booking
enter the API address and a shared secret matching `WOO_WEBHOOK_SECRET`. Put `[mizuki_booking]`
on the booking page and `[mizuki_my_bookings]` on a "My bookings" page.

## Before going live

The client has not yet supplied a few things, and the system uses placeholders until they do:

1. **Class sizes.** Every seeded class uses a placeholder of 8. Set the real numbers per course
   under Settings, and per class on the calendar.
2. **Dates already closed** for the rest of the year.
3. **WooCommerce product IDs.** Three kinds, all set in the console:
   - Paid workshops → Settings → Courses.
   - Course packages → Settings → Courses, along with how many sessions a purchase grants.
   - The Autumn Ikebana Course → Settings → Set courses. **Until this one is set, buying that
     course in the shop books nothing** — the order arrives with no way to tell what it was for.
4. **Whether Sunday 27 September should have an Ikebana workshop.** October has both a
   fourth-weekend course morning (24th) and a Sunday two-session day (25th); September has the
   26th but no 27th. It may well be deliberate — worth one line of confirmation.
5. **Confirmation that "3 days" means exact hours** (Saturday 10:00 → Wednesday 10:00) rather
   than whole calendar days. The system currently does exact hours, matching the client's own
   Saturday/Wednesday example.
