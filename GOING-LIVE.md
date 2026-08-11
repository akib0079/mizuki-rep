# Going live

Ordered by what blocks launch, not by effort. Nothing here is written yet in production —
everything so far has run against a local database with invented students.

## 1. Needed from the studio

Four of these the system cannot guess, and one of them silently breaks the shop if it is missed.

| | Why it matters |
|---|---|
| **Class size per course** | Every seeded class currently uses a placeholder of **8**. If the Ikebana room really holds 6, the calendar will sell 8 places. Set per course under Settings, and per class on the calendar. |
| **WooCommerce product IDs** | For each paid workshop, each course package, and **the Autumn Ikebana Course**. Until the Autumn course has its product id, buying it in the shop books nothing at all — the order arrives with no way to tell what it was for. |
| **Dates already closed** | Holidays and away days through the rest of the year, so they never appear as bookable. |
| **Sun 27 Sept — is there an Ikebana workshop?** | October has both a 4th-weekend course morning (24th) and a Sunday two-session day (25th). September has the 26th but no 27th. Probably deliberate — worth one line of confirmation. |
| **Is "3 days" exact hours?** | Built as 72 hours, so a Saturday 10:00 class locks Wednesday 10:00 — matching the studio's own example. If they mean whole calendar days, it is one setting. |

## 2. Accounts to open

**MongoDB Atlas** — see the note on tier below.

**Resend**, for email. The free tier covers 3,000 messages a month, which is well beyond a
studio this size. Deliberately not Hostinger's SMTP: shared-host mail is rate-limited and lands
in spam, and a class reminder that quietly never arrives is worse than not offering reminders.

**Telegram bot** (optional, 2 minutes) — message @BotFather, then @userinfobot for the chat id.
This is what makes "notify me when someone books" an actual phone alert rather than another
email in the pile.

## 3. DNS

Two records on `mizuki.com.sg`:

- **A / CNAME** for `api.mizuki.com.sg`, pointing at the Hostinger Node app.
- **SPF and DKIM** for Resend. Without these, confirmations and reminders go to spam — which
  looks identical to the system being broken.

Both domains must be on HTTPS. The student session cookie is `SameSite=None; Secure` in
production, because the widget runs on the WordPress site and calls the API on a subdomain;
browsers drop that cookie entirely over plain HTTP.

## 4. Deploy

```bash
# Hostinger hPanel → Websites → Add Website → Node.js, on api.mizuki.com.sg
# Deploy from GitHub, then set the environment variables from apps/api/.env.example
npm run seed          # courses, weekly timetable, weekend workshops, email templates
npm run create-admin  # the studio's sign-in — interactive, so no password in shell history
```

One hPanel cron entry, every five minutes. This is what sends reminders, releases unpaid holds,
keeps the three-month calendar filled and posts the morning digest:

```bash
curl -fsS -X POST https://api.mizuki.com.sg/api/jobs/tick -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

WordPress:

```bash
npm run package:wp    # produces wp-plugin/mizuki-booking-bridge.zip
```

Upload under Plugins → Add New → Upload, activate, then Settings → Mizuki Booking: enter the API
address and a shared secret matching `WOO_WEBHOOK_SECRET`. Put `[mizuki_booking]` on the booking
page and `[mizuki_my_bookings]` on a "My bookings" page.

## 5. The database tier is a real decision

**Atlas M0 (free) has no backups.** It is right for the development work done so far and wrong
for a live booking system: if it is lost, every booking, course package balance and student
record goes with it, and the studio has no way to reconstruct who paid for what.

M0 also has 512MB of storage, shared CPU, and can be paused after inactivity.

**M10 (~US$57/mo)** has continuous backups and point-in-time restore. **M2 (~US$9/mo)** has daily
snapshots and is the honest minimum. The gap between "free" and "£7 a month" is the gap between
losing the studio's records and not.

Whichever tier, restrict Atlas Network Access to the Hostinger app's IP rather than leaving it
open to the world.

## 6. Before opening it to students

- [ ] Clear the demo data — 8 invented students and ~58 bookings, including a deliberately
      over-capacity class. `npm run seed` does not remove them.
- [ ] Set the real class sizes, then check the calendar shows what the studio expects.
- [ ] Send a test of each email template to a real inbox and confirm it lands in **Inbox**, not
      spam. Check the `.ics` attachment opens in both Google and Apple Calendar.
- [ ] Book a paid workshop end to end with a WooCommerce test order: place held → paid →
      confirmed → confirmation email → appears on the studio calendar.
- [ ] Abandon a checkout and confirm the place returns after the hold window.
- [ ] Reschedule as a student, and confirm the 24h/72h rules behave as the studio expects.
- [ ] Turn on two-factor sign-in for the studio account (Settings → Security).
- [ ] Confirm the cron is firing — `/api/jobs/tick` returns counts, and the morning digest
      arrives the next day.

## 7. Known limits

**Not tested on Hostinger.** Everything here has run locally against a real MongoDB. The Node
app, the cron, and the WordPress plugin have not been exercised on the actual host, and that is
where surprises usually live — file permissions, environment variables, cold starts.

**No staging environment.** Worth pointing a second Hostinger site and a separate Atlas database
at the same repo before changing anything once students are relying on it.

**Load is untested beyond a sanity check.** For a studio of this size that is almost certainly
fine — but the calendar endpoint is the one to watch if a workshop is ever promoted widely.

**Undo has no time limit.** A cancelled class can be restored at any point while it is still in
the future. That is deliberate, but it means a class cancelled by mistake three weeks ago can
still be brought back with its students re-booked, which may surprise someone.
