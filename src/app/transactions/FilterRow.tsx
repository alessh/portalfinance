'use client';

/**
 * FilterRow — Plan 02-06.
 *
 * Client component for the month + account selects on /transactions.
 * Auto-submits the parent form on change so filtering works without
 * a separate submit button (graceful degradation: noscript falls back
 * to the "Filtrar" submit button).
 */
import { useRef } from 'react';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterRowProps {
  month_options: FilterOption[];
  selected_month: string;
  account_options: FilterOption[];
  selected_account: string;
}

export function FilterRow({
  month_options,
  selected_month,
  account_options,
  selected_account,
}: FilterRowProps) {
  const form_ref = useRef<HTMLFormElement>(null);

  const submit = () => {
    form_ref.current?.requestSubmit();
  };

  return (
    <form
      ref={form_ref}
      method="GET"
      action="/transactions"
      className="flex flex-wrap gap-3 items-end"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="month-select" className="text-xs font-medium text-muted-foreground">
          Mês
        </label>
        <select
          id="month-select"
          name="month"
          defaultValue={selected_month}
          onChange={submit}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {month_options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {account_options.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="account-select" className="text-xs font-medium text-muted-foreground">
            Conta
          </label>
          <select
            id="account-select"
            name="account"
            defaultValue={selected_account}
            onChange={submit}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Todas as contas</option>
            {account_options.map((acc) => (
              <option key={acc.value} value={acc.value}>
                {acc.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Noscript fallback submit button */}
      <noscript>
        <button
          type="submit"
          className="h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent"
        >
          Filtrar
        </button>
      </noscript>
    </form>
  );
}
