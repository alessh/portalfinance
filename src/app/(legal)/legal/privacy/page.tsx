/**
 * Política de Privacidade page — Phase 1 skeleton.
 *
 * Renders the docs/legal/privacy-v1.md file in a readable format.
 * Phase 1 intentionally uses a simple pre-formatted approach to avoid
 * adding MDX (heavy for this wave). Phase 6 can upgrade to MDX or a
 * proper markdown renderer when legal text is finalised.
 *
 * This page is the link destination for consent-screen "Política de
 * Privacidade" links (SignupForm + ConsentScreen).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const metadata = {
  title: 'Política de Privacidade — Portal Finance',
  description: 'Política de Privacidade do Portal Finance (rascunho — revisão jurídica pendente)',
};

export default function PrivacyPage() {
  let content: string;
  try {
    content = readFileSync(
      resolve(process.cwd(), 'docs/legal/privacy-v1.md'),
      'utf8',
    );
  } catch {
    content = '# Política de Privacidade\n\nDocumento em preparação.';
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
        {content}
      </pre>
    </main>
  );
}
