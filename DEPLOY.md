# Deploying to production

Every step is marked **[you]** or **[me]**. Most are yours — I cannot sign into Hostinger,
MongoDB Atlas, your DNS or WordPress, and I do not handle passwords. What I can do is prepare
everything, check your configuration, and verify each stage once it is reachable.

Work top to bottom. Each stage has a **checkpoint** — send me what it asks for and I will confirm
it is right before you move on, so a mistake surfaces at the step that caused it.

---

## Stage 1 — MongoDB Atlas

**[you]**

1. Create an account at mongodb.com/cloud/atlas.
2. Create a cluster. **Not M0** — it has no backups, and losing this database means losing every
   booking, package balance and student record with no way to reconstruct who paid for what.
   **M2 (~US$9/mo)** is the honest minimum; M10 adds point-in-time restore.
3. Region: Singapore (`ap-southeast-1`), closest to the studio and its students.
4. Database Access → add a user with **readWrite** on a database named `mizuki`.
5. Network Access → add the Hostinger app's outbound IP. Add `0.0.0.0/0` only temporarily
   while testing, and remove it once the app's IP is known.
6. Copy the connection string.

**Checkpoint** — send me the connection string **with the password replaced by `xxxx`**. I will
check the format, database name and options are right. Never send me the real password.

---

## Stage 2 — Resend, for email

**[you]**

1. Sign up at resend.com. The free tier is 3,000 messages a month — far beyond a studio this size.
2. Add the domain `mizuki.com.sg`.
3. Resend will give you **SPF and DKIM** DNS records. Add them in Hostinger → Domains → DNS.
4. Wait for Resend to show the domain as Verified.
5. Create an API key.

This step is not optional dressing. Without SPF and DKIM every confirmation and reminder goes to
spam, which from the studio's side looks identical to the system being broken.

**Checkpoint** — tell me when Resend shows **Verified**. I will send a test through each of the
eleven templates once the API is up.

---

## Stage 3 — DNS for the API

**[you]**

In Hostinger → Domains → DNS, point `api.mizuki.com.sg` at the Node app you create in Stage 4.
Hostinger usually wires this itself when you add the subdomain as a website; if not, add the
record it tells you to.

HTTPS is required on both `mizuki.com.sg` and `api.mizuki.com.sg`. The student session cookie is
`SameSite=None; Secure`, because the widget runs on the WordPress site and calls the API on a
subdomain — browsers discard that cookie entirely over plain HTTP, and sign-in silently fails.

---

## Stage 4 — The API on Hostinger

**[you]**

1. hPanel → Websites → **Add Website** → **Node.js**.
2. Domain: `api.mizuki.com.sg`. This adds a new site; it does not touch the WordPress install.
3. Deploy from GitHub: `akib0079/mizuki-rep`, branch `main`.
4. Build command `npm install && npm run build`, start command `npm start`, working directory
   `apps/api`, Node 20 or newer.
5. Add the environment variables — the full list is in `apps/api/.env.example`. I have generated
   your secrets separately; paste those in rather than inventing your own.

Set these to real values:

```
NODE_ENV=production
MONGODB_URI=<from Stage 1>
RESEND_API_KEY=<from Stage 2>
PUBLIC_API_URL=https://api.mizuki.com.sg
PUBLIC_SITE_URL=https://mizuki.com.sg
CORS_ORIGINS=https://mizuki.com.sg,https://www.mizuki.com.sg
ADMIN_ALERT_EMAIL=<where booking alerts should go>
MAIL_FROM=Mizuki Flora <hello@mizuki.com.sg>
```

**Checkpoint** — send me `https://api.mizuki.com.sg/health`. It should return
`{"ok":true,"db":"connected"}`. If `db` says disconnected, the Atlas IP allowlist is the usual
cause. I will also check the boot log for the warnings the server prints about anything missing.

---

## Stage 5 — Load the studio's data

**[you]** — run once, from the Hostinger terminal or a local shell pointed at the production
`MONGODB_URI`:

```bash
npm run seed
```

That loads the five courses, the weekly Tue/Wed/Thu IFDA timetable, every weekend workshop
through November, the Autumn Ikebana Course, and the eleven email templates. It creates **no**
students and **no** bookings. It is safe to run again.

```bash
npm run create-admin
```

Interactive on purpose, so the studio's password never lands in a shell history file. Choose
something long; you will turn on two-factor in Stage 8.

**Checkpoint** — tell me it finished and I will verify the seeded timetable matches what the
client sent, date by date.

---

## Stage 6 — Cron

**[you]** hPanel → Advanced → Cron Jobs. Every five minutes:

```bash
curl -fsS -X POST https://api.mizuki.com.sg/api/jobs/tick -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

This is what sends the two-day reminders, releases places held by abandoned checkouts, keeps the
rolling three-month calendar filled, and posts the morning digest. Without it the calendar
quietly stops extending and reminders never go out.

**Checkpoint** — send me the output of one manual run. It returns counts for each job.

---

## Stage 7 — WordPress

**[me]** Build the plugin:

```bash
npm run package:wp
```

**[you]**

1. wp-admin → Plugins → Add New → Upload → `wp-plugin/mizuki-booking-bridge.zip` → Activate.
2. Settings → Mizuki Booking: enter `https://api.mizuki.com.sg` and the **same**
   `WOO_WEBHOOK_SECRET` you put in Hostinger. If these differ, paid bookings never confirm.
3. Create a page with `[mizuki_booking]` on it, and another with `[mizuki_my_bookings]`.
4. Link both from the site menu.

---

## Stage 8 — Studio settings

**[you]**, in the console at `https://api.mizuki.com.sg/admin`:

1. **Settings → Courses** — set the real class size for each course. Everything is currently a
   placeholder of 8.
2. **Settings → Courses** — WooCommerce product ID for each paid workshop and each package.
3. **Settings → Set courses** — the product ID for the **Autumn Ikebana Course**. Until this is
   set, buying that course in the shop books nothing and nobody finds out until a student
   arrives.
4. **Closed dates** — holidays and away days through the rest of the year.
5. **Settings → Security** — turn on two-factor sign-in.
6. **Settings → Alerts** — turn on push, and add the Telegram bot token if you want a real phone
   alert rather than another email.

---

## Stage 9 — Before telling students

Do these on the live site, in this order.

- [ ] Book a **free or package** class as a student. Confirmation email arrives, lands in Inbox
      not spam, and the `.ics` opens in Google and Apple Calendar.
- [ ] Book a **paid workshop**. Place is held, checkout completes, booking confirms, the studio
      gets an alert.
- [ ] Start a paid booking and **abandon it**. The place returns after the hold window.
- [ ] **Reschedule** as a student, and confirm the 24h/72h rules match what the studio expects.
- [ ] **Cancel a class** as the studio and confirm the booked students are emailed.
- [ ] Check the calendar on a phone.
- [ ] Confirm the morning digest arrives the next day — that proves cron is really running.

---

## What I need from you to help

Send these when you have them and I will do the rest:

1. The Atlas connection string **with the password masked**.
2. `https://api.mizuki.com.sg/health` once it is up.
3. The WooCommerce product IDs — I will set them for you if you would rather.
4. The real class sizes per course.
5. Any error text or boot log, verbatim, if a stage does not behave.

**Never send me** passwords, the real Atlas password, your Hostinger login, or the WordPress
admin password. I do not need them, and I will not enter them anywhere.
