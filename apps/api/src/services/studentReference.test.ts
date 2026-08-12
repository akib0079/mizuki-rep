import { describe, expect, it } from 'vitest'
import { StudentModel } from '../models/index.js'
import { backfillReferences } from './studentReference.js'

/**
 * Two people with the same name.
 *
 * They have always been separate records — email is the identity key — but nothing on screen
 * distinguished them, so the studio could not tell which "Akib Tan" had paid. These tests pin
 * both halves: that the duplicate name is genuinely accepted, and that the two end up with
 * different references.
 */

describe('students with the same name', () => {
  it('accepts both, as separate people', async () => {
    const first = await StudentModel.create({
      name: 'Akib Tan',
      email: 'akib.one@example.com',
      phone: '+65 9111 1111',
    })
    const second = await StudentModel.create({
      name: 'Akib Tan',
      email: 'akib.two@example.com',
      phone: '+65 9222 2222',
    })

    expect(String(first._id)).not.toBe(String(second._id))
    expect(await StudentModel.countDocuments({ name: 'Akib Tan' })).toBe(2)
  })

  it('gives them different references, so a person can tell them apart', async () => {
    const first = await StudentModel.create({ name: 'Akib Tan', email: 'a1@example.com' })
    const second = await StudentModel.create({ name: 'Akib Tan', email: 'a2@example.com' })

    expect(first.reference).toMatch(/^MZ-\d{4}$/)
    expect(second.reference).toMatch(/^MZ-\d{4}$/)
    expect(first.reference).not.toBe(second.reference)
  })

  it('still refuses a second account on one email address', async () => {
    await StudentModel.create({ name: 'Akib Tan', email: 'same@example.com' })

    // Otherwise course packages and magic links would have two records to choose between.
    await expect(
      StudentModel.create({ name: 'Someone Else', email: 'same@example.com' }),
    ).rejects.toThrow()
  })
})

describe('references', () => {
  it('never hands the same one to two students created at once', async () => {
    // The counter is what makes this safe; counting existing students would collide here.
    const students = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        StudentModel.create({ name: `Student ${i}`, email: `bulk${i}@example.com` }),
      ),
    )

    const refs = students.map((s) => s.reference)
    expect(refs.every((r) => typeof r === 'string' && r.length > 0)).toBe(true)
    expect(new Set(refs).size).toBe(students.length)
  })

  it('keeps the reference it was given when the student is edited', async () => {
    const student = await StudentModel.create({ name: 'Mei', email: 'mei-ref@example.com' })
    const original = student.reference

    student.phone = '+65 9333 3333'
    await student.save()

    expect(student.reference).toBe(original)
  })

  it('backfills students who predate references, and is safe to re-run', async () => {
    const student = await StudentModel.create({ name: 'Older', email: 'older@example.com' })
    // Straight through the driver, so the save hook cannot quietly put one back.
    await StudentModel.collection.updateOne({ _id: student._id }, { $set: { reference: null } })

    expect(await backfillReferences()).toBe(1)
    const filled = await StudentModel.findById(student._id)
    expect(filled!.reference).toMatch(/^MZ-\d{4}$/)

    // Second pass finds nothing left to do, rather than renumbering everyone.
    expect(await backfillReferences()).toBe(0)
    const unchanged = await StudentModel.findById(student._id)
    expect(unchanged!.reference).toBe(filled!.reference)
  })
})
