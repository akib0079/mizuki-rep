import { useState } from 'react'
import { widgetApi } from './api.js'

/**
 * A country's flag, drawn flat.
 *
 * Deliberately not the flag emoji. An emoji is drawn by whatever machine is looking at it, so the
 * same booking form showed Apple's glossy waving flag on a phone, a flat one on Android, and the
 * bare letters on Windows — three different pictures of the same fact, none of them matching the
 * rest of the interface.
 *
 * The country code sits underneath the picture and shows through if the picture never arrives:
 * a slow connection, or the booking system updated after the plugin. "MY" is a smaller thing to
 * see than a broken-image icon, and still answers the question the flag was there to answer.
 *
 * It is drawn by CSS from the data attribute rather than written into the element, so it is not
 * part of the text: the code is usually printed next to the flag as well, and a copied line would
 * otherwise read "MYMY +60 123456789".
 */
export function CountryFlag({ code, className = '' }: { code: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const label = code.toUpperCase().replace(/[^A-Z]/g, '')

  if (!label) return null

  return (
    <span className={className ? `mzk-flag ${className}` : 'mzk-flag'} data-code={label} title={label} aria-hidden>
      {!failed && <img src={widgetApi.flagUrl(label)} alt="" onError={() => setFailed(true)} />}
    </span>
  )
}
