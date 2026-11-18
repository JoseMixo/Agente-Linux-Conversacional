import React, { useMemo, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-sql';
import { Check, Copy, Terminal } from 'lucide-react';

interface CodeBlockProps {
  language: string;
  value: string;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  kt: 'kotlin',
  kts: 'kotlin',
  yml: 'yaml',
  conf: 'ini',
  systemd: 'ini',
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const normalizedLang = useMemo(() => {
    const raw = (language || 'bash').toLowerCase().trim();
    return LANGUAGE_ALIASES[raw] ?? raw;
  }, [language]);

  const highlightedHtml = useMemo(() => {
    const grammar = Prism.languages[normalizedLang] ?? Prism.languages.bash ?? Prism.languages.plain;
    try {
      return Prism.highlight(value, grammar, normalizedLang);
    } catch {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [normalizedLang, value]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback silencioso en caso de permisos restringidos
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/95 shadow-inner">
      {/* Barra superior de bloque de código con etiqueta de lenguaje y botón en esquina superior derecha */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/80 px-3 py-1.5 text-xs font-mono text-zinc-400">
        <span className="inline-flex items-center gap-1.5 uppercase tracking-wider text-emerald-400/90">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          {normalizedLang}
        </span>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copiar código al portapapeles"
          title="Copiar al portapapeles"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-zinc-700/80 bg-zinc-800/90 px-2 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:border-emerald-500/60 hover:bg-zinc-800 hover:text-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-emerald-400">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-zinc-200" aria-hidden="true" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>

      {/* Cuerpo del código resaltado con Prism.js */}
      <pre className={`language-${normalizedLang} overflow-x-auto p-3.5 text-xs leading-relaxed`}>
        <code
          className={`language-${normalizedLang}`}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  );
};
