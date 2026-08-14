import { useEffect, useRef } from 'react'
import { CourseContact, CoursePrice, CourseSections, hasSections } from './CourseBody.js'
import type { PublicCourse, StudioContact } from './api.js'

/**
 * What a course is, for someone deciding whether to book it, shown over the calendar.
 *
 * The calendar answers "when", and until this existed that was all a student could find out
 * without emailing the studio — a person landing on a class called "IFDA Trial & Regular —
 * Morning" had no way to learn what that was.
 *
 * The content itself lives in CourseBody, shared with the course's own page. This file is only
 * the popup around it: the backdrop, the escape key, and where focus goes.
 */

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

  return (
    <div className="mzk-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/*
        Narrow when there is little to read. 820px is the width two columns of sections need; a
        course with only a description filled that width with one sentence and a lot of white,
        which reads as something that failed to load rather than as a short answer.
      */}
      <div
        className={
          hasSections(course)
            ? 'mzk mzk-modal mzk-course-modal'
            : 'mzk mzk-modal mzk-course-modal mzk-course-modal-narrow'
        }
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

          <CoursePrice course={course} />
          <CourseSections course={course} />
          <CourseContact studio={studio} />

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
  )
}
