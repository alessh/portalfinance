'use client';
/**
 * PasswordField — input + show/hide eye toggle (UI-SPEC § 2.2 / 2.3).
 *
 * The aria-label on the toggle button mirrors visibility state — never
 * static (UI-SPEC § Accessibility). Touch target ≥ 44px.
 */
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PasswordFieldProps
  extends Omit<React.ComponentProps<typeof Input>, 'type'> {
  /** Control id used by `<label htmlFor=...>`. */
  id?: string;
}

export function PasswordField({ className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-12', className)}
        {...props}
      />
      <button
        type="button"
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center justify-center min-w-11 min-h-11 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-md"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
