import { useId, useState } from 'react'

/**
 * A password box you can look at.
 *
 * Typing a password blind and getting it wrong is how people end up choosing short ones, and on
 * a phone keyboard it is how they end up locked out of an account they created ten seconds ago.
 * The toggle sits inside the field so it costs no vertical space on a form that is already long.
 *
 * It resets to hidden on every mount: a booking page left open on a shared laptop should not
 * still be showing what somebody typed.
 */
export function PasswordField({
  label,
  value,
  onChange,
  hint,
  autoComplete = 'current-password',
  required = true,
  minLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  autoComplete?: string
  required?: boolean
  minLength?: number
}) {
  const [visible, setVisible] = useState(false)
  const hintId = useId()

  return (
    <label className="mzk-field">
      <span>{label}</span>
      <span className="mzk-pw">
        <input
          className="mzk-pw-input"
          type={visible ? 'text' : 'password'}
          value={value}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="mzk-pw-toggle"
          onClick={() => setVisible((v) => !v)}
          // Names the state it will produce, which is what somebody needs to hear.
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          /*
           * Out of the tab order. Between a password box and the button that submits it, a
           * toggle is an obstacle for anyone who types their password and presses enter.
           */
          tabIndex={-1}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </span>
      {hint && (
        <span className="mzk-muted mzk-small" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  )
}

const iconProps = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false as const,
}

function Eye() {
  return (
    <svg {...iconProps}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg {...iconProps}>
      <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.9M6.2 6.4A17.7 17.7 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  )
}
