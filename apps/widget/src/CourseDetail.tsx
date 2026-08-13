import { useEffect, useRef } from 'react'
import type { PublicCourse } from './api.js'

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

export function CourseDetail({
  course,
  onClose,
  onBook,
  canBook,
}: {
  course: PublicCourse
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

  const sections: { label: string; value: string; asList?: boolean }[] = [
    { label: 'What you will learn', value: course.whatYouLearn, asList: true },
    { label: 'Who it suits', value: course.suitableFor },
    { label: 'What we provide', value: course.whatIsProvided, asList: true },
    { label: 'What to bring', value: course.whatToBring, asList: true },
  ]

  return (
    <>
      {/* Same shape as BookingDialog: the backdrop closes on a click that started on itself, and
          the panel re-declares .mzk because it renders outside the calendar's own scope. */}
      <div
        className="mzk-modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="mzk mzk-modal mzk-course-modal" role="dialog" aria-modal="true" aria-label={course.name}>
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

          {course.priceNote?.trim() && (
            <div className="mzk-course-price">
              <span className="mzk-course-price-label">Price</span>
              <span>{course.priceNote}</span>
            </div>
          )}

          {sections
            .filter((s) => s.value?.trim())
            .map((s) => (
              <section className="mzk-course-section" key={s.label}>
                <h4>{s.label}</h4>
                {s.asList ? (
                  <ul>
                    {/* One line per point, which is how the studio types it in. */}
                    {s.value
                      .split('\n')
                      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
                      .filter(Boolean)
                      .map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                  </ul>
                ) : (
                  <p>{s.value}</p>
                )}
              </section>
            ))}

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
