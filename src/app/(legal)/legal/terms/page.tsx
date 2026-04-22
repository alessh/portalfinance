/**
 * Termos de Uso page — Phase 1 skeleton.
 *
 * Renders the docs/legal/terms-v1.md file in a readable format.
 * Phase 1 intentionally uses a simple pre-formatted approach to avoid
 * adding MDX (heavy for this wave). Phase 6 can upgrade to MDX or a
 * proper markdown renderer when legal text is finalised.
 *
 * This page is the link destination for consent-screen "Termos de Uso"
 * links (SignupForm + ConsentScreen). It does NOT expose any user data.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const metadata = {
  title: 'Termos de Uso — Portal Finance',
  description: 'Termos de Uso do Portal Finance (rascunho — revisão jurídica pendente)',
};

export default function TermsPage() {
  let content: string;
  try {
    content = readFileSync(
      resolve(process.cwd(), 'docs/legal/terms-v1.md'),
      'utf8',
    );
  } catch {
    content = '# Termos de Uso\n\nDocumento em preparação.';
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
        {content}
      </pre>
    </main>
  );
}
