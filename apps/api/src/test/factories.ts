import { Types } from 'mongoose'
import { dateKeyOf, studioInstant } from '@mizuki/shared'
import {
  BookingModel,
  CourseTypeModel,
  PackageModel,
  SessionModel,
  StudentModel,
  type CourseTypeDoc,
  type SessionDoc,
  type StudentDoc,
} from '../models/index.js'

let seq = 0
const uniq = () => `${Date.now()}-${++seq}`

export async function makeCourseType(overrides: Partial<Record<string, unknown>> = {}): Promise<CourseTypeDoc> {
  return CourseTypeModel.create({
    name: 'Ikebana',
    slug: `ikebana-${uniq()}`,
    colour: '#7c6a9c',
    bookingMode: 'paid',
    rescheduleCutoffHours: 72,
    cancelCutoffHours: 72,
    defaultDurationMins: 150,
    defaultCapacity: 8,
    ...overrides,
  })
}

export async function makeSession(
  overrides: { courseTypeId?: Types.ObjectId; date?: string; time?: string; durationMins?: number } & Record<string, unknown> = {},
): Promise<SessionDoc> {
  const {
    courseTypeId = new Types.ObjectId(),
    date = '2026-09-12',
    time = '10:00',
    durationMins = 180,
    ...rest
  } = overrides

  const startAt = studioInstant(date, time)
  return SessionModel.create({
    courseTypeId,
    startAt,
    endAt: new Date(startAt.getTime() + durationMins * 60_000),
    dateKey: dateKeyOf(startAt),
    capacity: 8,
    heldBack: 0,
    seatsTaken: 0,
    title: 'Test class',
    ...rest,
  })
}

export async function makeStudent(overrides: Partial<Record<string, unknown>> = {}): Promise<StudentDoc> {
  return StudentModel.create({
    name: 'Test Student',
    email: `student-${uniq()}@example.com`,
    ...overrides,
  })
}

export async function makeStudents(count: number): Promise<StudentDoc[]> {
  return Promise.all(Array.from({ length: count }, () => makeStudent()))
}

export async function makePackage(
  studentId: Types.ObjectId,
  courseTypeId: Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return PackageModel.create({
    studentId,
    courseTypeId,
    totalSessions: 8,
    usedSessions: 0,
    expiresAt: studioInstant('2027-12-31', '23:59'),
    status: 'active',
    ...overrides,
  })
}

export async function countLiveBookings(sessionId: Types.ObjectId): Promise<number> {
  return BookingModel.countDocuments({ sessionId, status: { $in: ['hold', 'confirmed'] } })
}
