import type { PublicCourse, StudioContact } from './api.js'

/**
 * What the studio has written about a course, rendered once.
 *
 * The same words appear in two places — the "Learn more" popup on the general booking page, and
 * the top of a course's own page — and they were about to be written twice. Two copies of a
 * layout drift the moment one is edited, and the studio would have no way to know which of them
 * a given student had seen.
 *
 * Every section is optional and an empty one is not rendered, so a half-written course reads as a
 * short piece rather than a form with gaps in it.
 */

/** One block, or nothing at all when the studio has not written it. */
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
        // Classed so the theme defence leaves it alone: it resets bare elements only.
        <p className="mzk-course-text">{value}</p>
      )}
    </section>,
  ]
}

/** True when there is enough written to be worth showing at all. */
export function hasSections(course: PublicCourse): boolean {
  return Boolean(
    course.whatYouLearn?.trim() ||
      course.suitableFor?.trim() ||
      course.whatIsProvided?.trim() ||
      course.whatToBring?.trim(),
  )
}

export function CourseSections({ course }: { course: PublicCourse }) {
  /*
   * Two columns, split by meaning rather than down the middle.
   *
   * Left is what the course *is* — what you will learn, who it is for. Right is what to expect on
   * the day. That grouping also happens to balance: a long list plus a short paragraph against
   * two short lists. Splitting one list across both would leave the reader crossing the panel
   * mid-sentence.
   */
  const main = [
    ...section('What you will learn', course.whatYouLearn, true),
    ...section('Who it suits', course.suitableFor),
  ]
  const aside = [
    ...section('What we provide', course.whatIsProvided, true),
    ...section('What to bring', course.whatToBring, true),
  ]

  if (main.length === 0 && aside.length === 0) return null

  // One column when only one side has anything, or the other sits as an empty gap beside it.
  const two = main.length > 0 && aside.length > 0

  return (
    <div className={two ? 'mzk-course-cols' : 'mzk-course-cols mzk-course-cols-one'}>
      {main.length > 0 && <div className="mzk-course-col">{main}</div>}
      {aside.length > 0 && <div className="mzk-course-col">{aside}</div>}
    </div>
  )
}

/**
 * What it costs.
 *
 * A line inside the popup, where it sits among other facts. On a course's own page it is given a
 * frame instead — for a student who has already paid, "there is nothing to pay for individual
 * lessons" is the sentence they came to check, and it should not have to be found among bullets.
 */
export function CoursePrice({ course, framed = false }: { course: PublicCourse; framed?: boolean }) {
  if (!course.priceNote?.trim()) return null

  return (
    <p className={framed ? 'mzk-course-price mzk-course-price-framed' : 'mzk-course-price'}>
      <span className="mzk-course-price-label">Price</span>
      {course.priceNote}
    </p>
  )
}

/**
 * How to reach the studio.
 *
 * Shown wherever somebody is deciding, because the questions that stop a booking are the ones
 * nobody thought to write down — parking, a wheelchair, whether a child can come.
 */
export function CourseContact({ studio }: { studio?: StudioContact | null }) {
  if (!studio || (!studio.phone && !studio.email)) return null

  return (
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
  )
}
