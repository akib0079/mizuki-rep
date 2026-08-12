import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { sessionsRemaining } from '@mizuki/shared'
import { createApp } from '../app.js'
import { OutboxModel, PackageModel, SessionModel, StudentModel, type CourseTypeDoc } from '../models/index.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { makeCourseType, makeSession } from '../test/factories.js'

/**
 * Buying a course package through the shop.
 *
 * "IFDA and Preserved Flower students' sessions are counted down as they book" — this is where
 * those sessions come from when a student buys a block rather than being granted one by hand.
 */
const app = createApp()
const SECRET = 'test-woo-webhook-secret'

const IFDA_PACKAGE_PRODUCT = 101
const IKEBANA_WORKSHOP_PRODUCT = 42

let ifda: CourseTypeDoc
let ikebana: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  ifda = await makeCourseType({
    name: 'IFDA',
    bookingMode: 'package',
    wooProductIds: [IFDA_PACKAGE_PRODUCT],
    packageGrantSessions: 8,
    packageValidityDays: 365,
  })
  ikebana = await makeCourseType({
    name: 'Ikebana',
    bookingMode: 'paid',
    wooProductIds: [IKEBANA_WORKSHOP_PRODUCT],
  })
})

function wooCallback(payload: unknown) {
  const body = JSON.stringify(payload)
  return request(app)
    .post('/api/woo/order')
    .set('Content-Type', 'application/json')
    .set('X-Mizuki-Signature', crypto.createHmac('sha256', SECRET).update(body).digest('hex'))
    .send(body)
}

const packageOrder = (overrides: Record<string, unknown> = {}, quantity = 1) => ({
  event: 'paid',
  orderId: 8001,
  status: 'processing',
  customer: { email: 'mei@example.com', name: 'Mei Lin', phone: '+65 9000 0000', wooId: 12 },
  lines: [{ sessionId: '', holdToken: '', productId: IFDA_PACKAGE_PRODUCT, quantity }],
  ...overrides,
})

describe('buying a course package', () => {
  it('grants the sessions the course is configured to sell', async () => {
    const res = await wooCallback(packageOrder()).expect(200)

    expect(res.body.granted).toHaveLength(1)

    const pkg = await PackageModel.findOne({ sourceOrderId: 8001 })
    expect(pkg).toBeTruthy()
    expect(pkg!.totalSessions).toBe(8)
    expect(pkg!.usedSessions).toBe(0)
    expect(pkg!.status).toBe('active')
    expect(String(pkg!.courseTypeId)).toBe(String(ifda._id))
  })

  it('creates the student from the order when they are new', async () => {
    await wooCallback(packageOrder()).expect(200)

    const student = await StudentModel.findOne({ email: 'mei@example.com' })
    expect(student).toBeTruthy()
    expect(student!.name).toBe('Mei Lin')
    expect(student!.wooCustomerId).toBe(12)
  })

  it('sets an expiry from the course validity period', async () => {
    await wooCallback(packageOrder()).expect(200)

    const pkg = await PackageModel.findOne({ sourceOrderId: 8001 })
    const daysAhead = (pkg!.expiresAt!.getTime() - Date.now()) / (24 * 3600_000)
    expect(daysAhead).toBeGreaterThan(360)
    expect(daysAhead).toBeLessThan(370)
  })

  it('gives two blocks when two are bought', async () => {
    await wooCallback(packageOrder({}, 2)).expect(200)

    const pkg = await PackageModel.findOne({ sourceOrderId: 8001 })
    expect(pkg!.totalSessions).toBe(16)
  })

  it('records how the package was created, in the ledger', async () => {
    await wooCallback(packageOrder()).expect(200)

    const pkg = await PackageModel.findOne({ sourceOrderId: 8001 })
    expect(pkg!.ledger).toHaveLength(1)
    expect(pkg!.ledger[0]).toMatchObject({ type: 'grant', delta: 8 })
    expect(pkg!.ledger[0]!.note).toContain('8001')
  })

  it('never grants twice, however often WooCommerce calls back', async () => {
    // Woo fires on `processing` and again on `completed`; a studio marking an order complete
    // by hand fires it a third time. The student must not collect three sets of sessions.
    await wooCallback(packageOrder()).expect(200)
    await wooCallback(packageOrder({ status: 'completed' })).expect(200)
    await wooCallback(packageOrder({ status: 'completed' })).expect(200)

    expect(await PackageModel.countDocuments({ sourceOrderId: 8001 })).toBe(1)
    const pkg = await PackageModel.findOne({ sourceOrderId: 8001 })
    expect(pkg!.totalSessions).toBe(8)
  })

  it('emails the student that their sessions are ready, once', async () => {
    await wooCallback(packageOrder()).expect(200)
    await wooCallback(packageOrder({ status: 'completed' })).expect(200)

    const emails = await OutboxModel.find({ type: 'package_granted' })
    expect(emails).toHaveLength(1)
    expect(emails[0]!.to).toBe('mei@example.com')
    expect(emails[0]!.bodyText).toContain('8 sessions')
    expect(emails[0]!.bodyText).not.toMatch(/\{\{/)
  })

  it('tells the studio a package sold', async () => {
    await wooCallback(packageOrder()).expect(200)
    expect(await OutboxModel.exists({ type: 'admin_package_sold' })).toBeTruthy()
  })

  it('adds a second package rather than merging when bought again later', async () => {
    await wooCallback(packageOrder()).expect(200)
    await wooCallback(packageOrder({ orderId: 8002 })).expect(200)

    const packages = await PackageModel.find({ studentId: (await StudentModel.findOne({ email: 'mei@example.com' }))!._id })
    expect(packages).toHaveLength(2)
    // Kept separate so each keeps its own expiry.
    expect(packages.map((p) => p.sourceOrderId).sort()).toEqual([8001, 8002])
  })
})

describe('the package is immediately usable', () => {
  it('lets the student book an IFDA class straight away', async () => {
    await wooCallback(packageOrder()).expect(200)

    const session = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-10-17' })
    const student = await StudentModel.findOne({ email: 'mei@example.com' })

    // Signed in via the magic-link flow in real use; here the point is the credits exist.
    const pkg = await PackageModel.findOne({ sourceOrderId: 8001 })
    expect(sessionsRemaining(pkg!)).toBe(8)

    const res = await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: String(session._id), email: 'mei@example.com', name: 'Mei Lin', phone: '+65 9123 4567' })
      .expect(200)

    /*
     * The account exists, so the student is asked to sign in rather than turned away — and rather
     * than having their newly bought credits spent by whoever typed the address.
     */
    expect(res.body.outcome).toBe('sign_in_required')
    expect(res.body.reason).toBe('email_known')
    expect(student).toBeTruthy()
  })
})

describe('orders that are not packages', () => {
  it('ignores a shop product the booking system knows nothing about', async () => {
    const res = await wooCallback(
      packageOrder({ lines: [{ sessionId: '', holdToken: '', productId: 999, quantity: 1 }] }),
    ).expect(200)

    expect(res.body.granted).toHaveLength(0)
    expect(res.body.confirmed).toHaveLength(0)
    expect(await PackageModel.countDocuments()).toBe(0)
  })

  it('still books a class when the order mixes a workshop with an ordinary product', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    const res = await wooCallback(
      packageOrder({
        lines: [
          { sessionId: '', holdToken: '', productId: 999, quantity: 1 },
          { sessionId: String(session._id), holdToken: '', productId: IKEBANA_WORKSHOP_PRODUCT, quantity: 1 },
        ],
      }),
    ).expect(200)

    expect(res.body.confirmed).toHaveLength(1)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('does not treat a paid workshop product as a package', async () => {
    // Ikebana sells single workshops, not blocks of sessions.
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    await wooCallback(
      packageOrder({
        lines: [
          { sessionId: String(session._id), holdToken: '', productId: IKEBANA_WORKSHOP_PRODUCT, quantity: 1 },
        ],
      }),
    ).expect(200)

    expect(await PackageModel.countDocuments()).toBe(0)
  })
})
