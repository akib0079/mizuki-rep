import { useState } from 'react'
import { flagFile } from '@mizuki/shared'

/**
 * A country's flag, drawn flat — the console's copy of what the booking form shows.
 *
 * Served from this same origin, so no host to configure. The country code sits underneath and
 * shows through if the picture never arrives, which is a smaller thing to see in a table of
 * students than a broken-image icon.
 *
 * That code is drawn by CSS from the data attribute rather than written into the element, so it
 * is not part of the text: the code is printed next to the flag as well, and a copied row would
 * otherwise read "MYMY +60 123456789".
 */
export function CountryFlag({ code }: { code: string }) {
  const [failed, setFailed] = useState(false)
  const label = code.toUpperCase().replace(/[^A-Z]/g, '')

  if (!label) return null

  return (
    <span className="flag" data-code={label} title={label} aria-hidden>
      {!failed && <img src={`/flags/${flagFile(label)}`} alt="" onError={() => setFailed(true)} />}
    </span>
  )
}
