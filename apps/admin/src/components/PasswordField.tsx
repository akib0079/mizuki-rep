import { useId, useState } from 'react'

/**
 * A password box you can look at.
 *
 * Typing a long password blind and getting it wrong twice is how people end up choosing short
 * ones. The toggle is a button rather than a checkbox so it can sit inside the field, and it
 * announces its state, because to a screen reader "the password is now visible" is the part
 * that matters — not that a button was pressed.
 *
 * Revealing resets to hidden on every mount: a console left open on a studio laptop should not
 * still be showing a password from an hour ago.
 */
export function PasswordField({
  label,
  value,
  onChange,
  hint,
  autoComplete = 'current-password',
  required = true,
  autoFocus = false,
  minLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  autoComplete?: string
  required?: boolean
  autoFocus?: boolean
  minLength?: number
}) {
  const [visible, setVisible] = useState(false)
  const hintId = useId()

  return (
    <label className="field">
      <span>{label}</span>
      <span className="pw-wrap">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          autoFocus={autoFocus}
          minLength={minLength}
          aria-describedby={hint ? hintId : undefined}
          className="pw-input"
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setVisible((v) => !v)}
          // The label describes the resulting state, which is what someone needs to hear.
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          // Skipped in the tab order: between the password box and the submit button, a toggle
          // is an obstacle for anyone typing a password and pressing enter.
          tabIndex={-1}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </span>
      {hint && (
        <span className="field-hint" id={hintId}>
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
