'use client';

/**
 * Demo Dashboard — UI-SPEC § 2.10.
 *
 * Plan 01-04 — D-03 (first post-signup screen).
 *
 * Renders illustrative data to prime the user's mental model before they
 * connect their bank account. A sticky "sample data" ribbon clearly signals
 * this is illustrative content.
 *
 * CRITICAL: Do NOT import Recharts here — Phase 4 dependency (UI-SPEC § 2.10
 * explicit). Use CSS-based horizontal bar list per spec.
 *
 * CRITICAL: Do NOT query the database — this component uses hard-coded
 * demoData constants.
 */
import { ChevronLeft, ChevronRight, FlaskConical, Home, ShoppingCart, Utensils, Car, MoreHorizontal } from 'lucide-react';
import { demoData, type DemoCategory } from '@/lib/demoData';
import { formatBRL } from '@/lib/formatCurrency';

// ---------------------------------------------------------------------------
// Icon mapping (avoids dynamic icon imports that break tree-shaking)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  'home': Home,
  'shopping-cart': ShoppingCart,
  'utensils': Utensils,
  'car': Car,
  'more-horizontal': MoreHorizontal,
};

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? MoreHorizontal;
  return <Icon className={className} size={16} />;
}

// ---------------------------------------------------------------------------
// Category bar row
// ---------------------------------------------------------------------------

function CategoryRow({ cat }: { cat: DemoCategory }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <CategoryIcon name={cat.icon} className="text-muted-foreground flex-shrink-0" />
      <span className="flex-1 text-sm text-foreground">{cat.name}</span>
      <span className="tabular-nums font-semibold text-sm text-foreground">
        {formatBRL(cat.amount)}
      </span>
      <span className="text-xs text-muted-foreground w-8 text-right">{cat.percentage}%</span>
      {/* CSS-based horizontal progress bar — Phase 4 will replace with Recharts */}
      <div className="w-16 h-2 bg-muted rounded overflow-hidden flex-shrink-0" aria-hidden="true">
        <div
          className="h-full bg-primary rounded transition-all"
          style={{ width: `${cat.percentage}%` }}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// DemoDashboard
// ---------------------------------------------------------------------------

export function DemoDashboard() {
  return (
    <div className="space-y-6">
      {/* Sample data ribbon — UI-SPEC § 2.10 */}
      {/*
        role="status" aria-live="polite": screen readers announce the demo context
        so assistive technology users understand this is illustrative data.
      */}
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950 border-l-4 border-primary rounded-r-md"
      >
        <FlaskConical size={16} className="text-primary flex-shrink-0" aria-hidden="true" />
        <p className="text-sm text-foreground flex-1">
          Estes são dados ilustrativos. Conecte sua conta bancária para ver seus números reais.
        </p>
        {/*
          "Conectar banco →" routes to /connect (Phase 2). In Phase 1 this page
          does not exist — aria-disabled communicates the non-functional state.
        */}
        <a
          href="/connect"
          className="text-sm text-primary font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-disabled="true"
          tabIndex={-1}
          title="Disponível na próxima fase"
        >
          Conectar banco →
        </a>
      </div>

      {/* Month navigation — UI-SPEC § 2.10 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="p-1 rounded-md text-muted-foreground"
          aria-label="Mês anterior"
          aria-disabled="true"
          tabIndex={-1}
          disabled
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-xl font-semibold text-foreground">{demoData.month}</h2>
        <button
          type="button"
          className="p-1 rounded-md text-muted-foreground"
          aria-label="Próximo mês"
          aria-disabled="true"
          tabIndex={-1}
          disabled
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Metric cards — 2-col grid on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Receitas */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Receitas</p>
          <p className="text-2xl font-semibold text-green-700 dark:text-green-400 tabular-nums">
            {formatBRL(demoData.receita_total)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Salário via PIX</p>
        </div>

        {/* Despesas */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Despesas</p>
          <p className="text-2xl font-semibold text-destructive tabular-nums">
            {formatBRL(demoData.despesas_total)}
          </p>
        </div>
      </div>

      {/* Net card */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Resultado do mês</p>
        <p
          className={`text-2xl font-semibold tabular-nums ${
            demoData.net >= 0
              ? 'text-green-700 dark:text-green-400'
              : 'text-destructive'
          }`}
        >
          {formatBRL(demoData.net)}
        </p>
      </div>

      {/* Category spending — CSS bar list */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
        <h3 className="text-base font-semibold text-foreground mb-3">Gastos por categoria</h3>
        <ul className="divide-y divide-border">
          {demoData.categories.map((cat) => (
            <CategoryRow key={cat.name} cat={cat} />
          ))}
        </ul>
      </div>
    </div>
  );
}
