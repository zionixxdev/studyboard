import { useState } from 'react';
import { GlassInput, type GlassInputProps } from '@/components/ui/GlassInput';
import { checkPassword } from '@/lib/utils';

/** Password field with a show/hide toggle and an optional strength meter. */
export function PasswordField({
  value,
  onChange,
  showStrength = false,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  showStrength?: boolean;
} & Omit<GlassInputProps, 'value' | 'onChange' | 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  const strength = checkPassword(value);

  return (
    <div>
      <GlassInput
        {...rest}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={rest.autoComplete ?? 'current-password'}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="focus-ring pill px-2 py-1 text-xs font-medium text-soft hover:text-ink"
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        }
      />
      {showStrength && value.length > 0 && (
        <div className="mt-2">
          <div className="flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={
                  'h-1 flex-1 rounded-full transition-colors ' +
                  (i < strength.score ? 'bg-accent' : 'bg-glass-bg/40')
                }
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-faint">
            {strength.ok ? 'Password strength: good.' : strength.problems[0]}
          </p>
        </div>
      )}
    </div>
  );
}
