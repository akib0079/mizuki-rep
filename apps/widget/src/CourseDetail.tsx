import { useEffect, useRef } from 'react'
import type { PublicCourse, StudioContact } from './api.js'

/**
 * What a course actually is, for someone deciding whether to book it.
 *
 * The calendar answers "when", and until now that was all a student could find out without
 * emailing the studio — a person landing on a class called "IFDA Trial & Regular — Morning" had
 * no way to learn what that was. The studio writes this once on the Courses page and it appears
 * wherever the course does.
 *
 * Every section is optional and an empty one is not rendered, so a half-written course reads as a
 * short panel rather than a form with gaps in it.
 */

/**
 * One block of the panel, or nothing at all when the studio has not written it.
 *
 * Returns an array so a caller can concatenate several and ask how many survived — which is how
 * the two columns decide whether they are two columns.
 */
function section(label: string, value: string | undefined, asList = false) {
  if (!value?.trim()) return []

  return [
    <section className="mzk-course-section" key={label}>
      <h4>{label}</h4>
      {asList ? (
        <ul>
          {/* One line per point, which is how the studio types it in. A line that already starts
              with a dash or a bullet has it stripped, rather than ending up with two. */}
          {value
            .split('\n')
            .map((line) => line.replace(/^[-•*]\s*/, '').trim())
            .filter(Boolean)
            .map((line, i) => (
              <li key={i}>{line}</li>
            ))}
        </ul>
      ) : (
        <p>{value}</p>
      )}
    </section>,
  ]
}

export function CourseDetail({
  course,
  studio,
  onClose,
  onBook,
  canBook,
}: {
  course: PublicCourse
  /** Shown so a question does not have to become an abandoned booking. */
  studio?: StudioContact | null
  onClose: () => void
  onBook?: () => void
  /** False when the class behind this panel is full, so the button would be a dead end. */
  canBook?: boolean
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  /*
   * Escape closes it, and focus starts inside.
   *
   * Without moving focus the panel opens "behind" the keyboard: tab goes on through the calendar
   * underneath, and a screen reader never announces that anything happened.
   */
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
   * Two columns, split by length rather than down the middle.
   *
   * Left is what the course *is* — what you will learn, who it is for. Right is what to expect on
   * the day. That grouping also happens to balance: the long list plus a short paragraph against
   * two short lists, so neither column runs out well before the other.
   *
   * Splitting a single list across both would have left the reader crossing the panel mid-sentence.
   */
  const mainSections = [
    ...section('What you will learn', course.whatYouLearn, true),
    ...section('Who it suits', course.suitableFor),
  ]
  const asideSections = [
    ...section('What we provide', course.whatIsProvided, true),
    ...section('What to bring', course.whatToBring, true),
  ]

  // One column when only one side has anything, or the other sits as an empty gap beside it.
  const twoColumns = mainSections.length > 0 && asideSections.length > 0

  return (
    <>
      {/* Same shape as BookingDialog: the backdrop closes on a click that started on itself, and
          the panel re-declares .mzk because it renders outside the calendar's own scope. */}
      <div
        className="mzk-modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {/*
          Narrow when there is little to read. 820px is the width two columns of sections need;
          a course with only a description in it filled that width with one sentence and a lot of
          white, which reads as something that failed to load rather than as a short answer.
        */}
        <div
          className={twoColumns ? 'mzk mzk-modal mzk-course-modal' : 'mzk mzk-modal mzk-course-modal mzk-course-modal-narrow'}
          role="dialog"
          aria-modal="true"
          aria-label={course.name}
        >
        {course.imageUrl?.trim() && (
          // Decorative: the name is right underneath it, so a description would only repeat it.
          <img
            className="mzk-course-img"
            src={course.imageUrl}
            alt=""
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}

        <div className="mzk-course-body">
          <div className="mzk-course-head">
            <span className="mzk-course-dot" style={{ background: course.colour }} aria-hidden />
            <h3 className="mzk-course-name">{course.name}</h3>
          </div>

          {course.description?.trim() && <p className="mzk-course-lede">{course.description}</p>}

          {/* A line, not a filled panel. One sentence did not need a box drawn round it. */}
          {course.priceNote?.trim() && (
            <p className="mzk-course-price">
              <span className="mzk-course-price-label">Price</span>
              {course.priceNote}
            </p>
          )}

          <div className={twoColumns ? 'mzk-course-cols' : 'mzk-course-cols mzk-course-cols-one'}>
            {mainSections.length > 0 && <div className="mzk-course-col">{mainSections}</div>}
            {asideSections.length > 0 && <div className="mzk-course-col">{asideSections}</div>}
          </div>

          {/*
            Always here, not only when a course happens to mention it.

            Somebody reading this panel is deciding, and the questions that stop a booking are the
            ones nobody thought to write down — parking, a wheelchair, whether a twelve-year-old
            can come. Without a way to ask, that person closes the page instead.
          */}
          {studio && (studio.phone || studio.email) && (
            <p className="mzk-course-contact">
              Any questions before you book?{' '}
              {studio.phone && (
                <>
                  Call us on <a href={`tel:${studio.phone.replace(/\s+/g, '')}`}>{studio.phone}</a>
                </>
              )}
              {studio.phone && studio.email && ' or '}
              {studio.email && (
                <>
                  email <a href={`mailto:${studio.email}`}>{studio.email}</a>
                </>
              )}
              .
            </p>
          )}

          <div className="mzk-row mzk-course-foot">
            <button type="button" className="mzk-btn" ref={closeRef} onClick={onClose}>
              Close
            </button>
            {onBook && canBook && (
              <button type="button" className="mzk-btn mzk-btn-primary" onClick={onBook}>
                Book this class
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </>
  )
}
