import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

interface MarkdownMessageProps {
  content: string;
  isStreaming?: boolean;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, isStreaming = false }) => {
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-zinc-200 font-sans">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed text-zinc-200">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-emerald-300">{children}</strong>,
          em: ({ children }) => <em className="italic text-amber-300/90">{children}</em>,
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1 text-zinc-300 marker:text-emerald-500">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1 text-zinc-300 marker:text-emerald-400 font-mono text-xs sm:text-sm">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          h1: ({ children }) => <h1 className="border-b border-zinc-800 pb-1 text-base font-bold text-emerald-400 font-mono">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-3 text-sm font-bold uppercase tracking-wider text-emerald-400 font-mono">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-2 text-sm font-semibold text-zinc-100 font-mono">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-amber-500/80 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-200/90 font-mono">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded border border-zinc-800">
              <table className="w-full border-collapse text-left text-xs font-mono">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-zinc-900 text-zinc-300 border-b border-zinc-800">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-t border-zinc-800/70 px-3 py-1.5 text-zinc-300">{children}</td>,
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const rawCode = String(children).replace(/\n$/, '');
            const isMultiline = rawCode.includes('\n') || Boolean(match);

            if (isMultiline) {
              return <CodeBlock language={match?.[1] ?? 'bash'} value={rawCode} />;
            }

            return (
              <code
                className="rounded border border-zinc-700/70 bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-emerald-300"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>

      {isStreaming && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-2 translate-y-0.5 bg-emerald-400 animate-pulse"
          title="Recibiendo flujo SSE..."
        />
      )}
    </div>
  );
};
