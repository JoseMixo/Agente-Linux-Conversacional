import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Cpu,
  Database,
  FileTerminal,
  HardDrive,
  Radio,
  Send,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { MarkdownMessage } from './components/MarkdownMessage';
import { consumeSseStream } from './services/sseClient';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  lineCount?: number;
  byteCount?: number;
  isStreaming?: boolean;
}

const SAMPLE_PROMPTS = [
  {
    label: 'Mosquitto :1883 / LWT Offline',
    snippet: `Nov 16 22:04:11 argos-fog systemd[1]: mosquitto.service: Main process exited, code=exited, status=1/FAILURE
Nov 16 22:04:11 argos-fog mosquitto[1422]: 1794888251: Socket error on client arduino_nodo01, disconnecting.
Nov 16 22:04:11 argos-fog mosquitto[1422]: 1794888251: Sending WILL message on iot/equipo07/cuarto_servidores/estado`,
  },
  {
    label: 'Kernel Panic SMP / 816 MHz',
    snippet: `[ 1420.881204] Internal error: Oops: 5 [#1] SMP THUMB2
[ 1420.881219] CPU: 2 PID: 0 Comm: swapper/2 Not tainted 6.18.2-armbian #1
[ 1420.881235] Hardware name: Allwinner sun8i Family (Q44_V4.0)
[ 1420.881251] hrtimer: interrupt took 418920 ns`,
  },
  {
    label: 'Volcado Telegraf / InfluxDB 1.8',
    snippet: `2026-11-16T22:08:00Z E! [inputs.mqtt_consumer] Error in plugin: metric parse error: expected field at 1:44: "{\"node_id\":\"arduino_nodo01\",\"temperature_c\":-99.0,\"quality\":\"invalid\"}"
2026-11-16T22:08:05Z W! [outputs.influxdb] When writing to [http://127.0.0.1:8086]: database "argos_metrics" write failed: engine: cache-max-memory-size exceeded`,
  },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'boot-msg',
    role: 'assistant',
    timestamp: '22:00:00',
    content: `### Consola SRE Nivel 3 Activa — Identidad: **Root**
Conectado al contexto de infraestructura **ARGOS (Nodo Fog Q44_V4.0 Allwinner H3 | Armbian Debian 13 \`armhf\` | 2 Cores @ 816 MHz)** y nodo Edge **Arduino UNO R4 WiFi**.

Pega el volcado de \`journalctl\`, \`systemctl status\`, trazas de **Mosquitto / Telegraf / InfluxDB 1.8** o describe el síntoma. Opero bajo **Método Científico estricto**: evidencia primero, mitigación verificada después.

\`\`\`bash
# Comandos base de triaje rápido en el nodo Fog
systemctl is-active cpu-limit mosquitto telegraf influxdb grafana-server
journalctl -p err -n 25 --no-pager
\`\`\``,
  },
];

export const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [sseEndpoint, setSseEndpoint] = useState('/api/chat/stream');
  const [isStreaming, setIsStreaming] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages]);

  const nowTime = () => {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  };

  const stopStream = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const lineCount = trimmed.split(/\r?\n/).length;
    const byteCount = new Blob([trimmed]).size;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: nowTime(),
      lineCount,
      byteCount,
    };

    const assistantId = `root-${Date.now() + 1}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: nowTime(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    await consumeSseStream({
      endpoint: sseEndpoint,
      prompt: trimmed,
      signal: controller.signal,
      onToken: (token) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: msg.content + token }
              : msg
          )
        );
      },
      onComplete: () => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, isStreaming: false } : msg
          )
        );
        setIsStreaming(false);
        abortControllerRef.current = null;
      },
      onError: (err) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  isStreaming: false,
                  content:
                    msg.content +
                    `\n\n> **[ERROR DE CANAL SSE]:** \`${err.message}\`\n> Verifica que el endpoint \`${sseEndpoint}\` esté accesible y emita cabeceras \`Content-Type: text/event-stream\`.`,
                }
              : msg
          )
        );
        setIsStreaming(false);
        abortControllerRef.current = null;
      },
    });
  };

  // IME-safe Enter-to-submit following modern-web-guidance (`ime-safe-enter-submit`)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      formRef.current?.requestSubmit();
    }
  };

  const inputLines = input ? input.split(/\r?\n/).length : 0;
  const inputBytes = input ? new Blob([input]).size : 0;

  return (
    <div className="flex h-dvh w-full flex-col bg-zinc-950 text-zinc-100 font-mono selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Cabecera Superior de Operaciones SRE */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-emerald-300">
            <Terminal className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <span className="font-bold tracking-wide">root@argos-fog:~#</span>
          </div>

          <div className="hidden items-center gap-3 text-zinc-400 md:flex">
            <span className="inline-flex items-center gap-1" title="SoC Allwinner H3 - Clamping activo">
              <Cpu className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>maxcpus=2 @ 816MHz</span>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="inline-flex items-center gap-1" title="Memoria RAM DDR3">
              <HardDrive className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              <span>1GB RAM / 8GB NAND</span>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="inline-flex items-center gap-1" title="Pipeline TIG + Mosquitto">
              <Database className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Mosquitto :1883 • InfluxDB 1.8.10 • Grafana :3000</span>
            </span>
          </div>
        </div>

        {/* Configuración del Endpoint SSE y Controles de Sesión */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
            <Radio
              className={`h-3.5 w-3.5 ${
                isStreaming ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'
              }`}
              aria-hidden="true"
            />
            <label htmlFor="sse-endpoint-input" className="text-[11px] text-zinc-400">
              SSE:
            </label>
            <input
              id="sse-endpoint-input"
              type="text"
              value={sseEndpoint}
              onChange={(e) => setSseEndpoint(e.target.value)}
              className="w-40 bg-transparent text-xs text-zinc-200 focus:outline-none"
              title="Endpoint Server-Sent Events (text/event-stream)"
            />
          </div>

          <button
            type="button"
            onClick={() => setMessages(INITIAL_MESSAGES)}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
            title="Limpiar buffer de consola"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Limpiar</span>
          </button>
        </div>
      </header>

      {/* Área Principal de Mensajes en Streaming (Sin bloqueos de UI) */}
      <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {messages.map((msg) => (
            <article
              key={msg.id}
              className={`rounded-md border px-4 py-3 ${
                msg.role === 'user'
                  ? 'border-zinc-800 bg-zinc-900/50'
                  : 'border-emerald-900/50 bg-zinc-900/90 shadow-sm'
              }`}
            >
              {/* Metadatos de cabecera de mensaje */}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-1.5 text-xs">
                <div className="flex items-center gap-2">
                  {msg.role === 'user' ? (
                    <>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-bold text-amber-300">
                        operador@equipo07:~$
                      </span>
                      {msg.lineCount && msg.lineCount > 1 && (
                        <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-400">
                          <FileTerminal className="h-3 w-3 text-amber-400" aria-hidden="true" />
                          {msg.lineCount} líneas ({msg.byteCount} B)
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-950/90 border border-emerald-500/40 px-1.5 py-0.5 font-bold text-emerald-300">
                        <ShieldAlert className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                        ROOT [SRE-L3]
                      </span>
                      {msg.isStreaming && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                          <Activity className="h-3 w-3" aria-hidden="true" />
                          STREAMING SSE
                        </span>
                      )}
                    </>
                  )}
                </div>
                <time className="text-[11px] text-zinc-500">{msg.timestamp}</time>
              </div>

              {/* Contenido del Mensaje */}
              {msg.role === 'user' ? (
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded bg-zinc-950/90 p-3 font-mono text-xs leading-relaxed text-zinc-300 border border-zinc-800/70">
                  {msg.content}
                </pre>
              ) : (
                <MarkdownMessage content={msg.content} isStreaming={msg.isStreaming} />
              )}
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Panel Inferior de Entrada con Textarea Auto-Expandible para Pegados Masivos */}
      <footer className="border-t border-zinc-800 bg-zinc-900/95 px-3 py-3 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-2">
          {/* Inyectores rápidos de logs de prueba + telemetría del buffer de entrada */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">Inyectar log de prueba:</span>
              {SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => setInput(sample.snippet)}
                  className="cursor-pointer rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  {sample.label}
                </button>
              ))}
            </div>

            {input.length > 0 && (
              <div className="text-[11px] text-zinc-400">
                Buffer: <span className="text-emerald-400">{inputLines}</span> línea(s) •{' '}
                <span className="text-emerald-400">{inputBytes}</span> bytes
              </div>
            )}
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="relative flex items-end gap-2">
            <label htmlFor="sre-log-input" className="sr-only">
              Consola de entrada de comandos, síntomas o volcados de logs de systemd e InfluxDB
            </label>

            <div
              className="growable-textarea flex-1 rounded-md border border-zinc-700/90 bg-zinc-950 focus-within:border-emerald-500/80 focus-within:ring-1 focus-within:ring-emerald-500/50"
              data-replicated-value={input}
            >
              <textarea
                id="sre-log-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pega aquí volcados masivos de journalctl, systemctl status, trazas de InfluxDB/Mosquitto o describe el síntoma... (Enter para enviar, Shift+Enter para salto de línea)"
                className="terminal-textarea block w-full bg-transparent px-3.5 py-2.5 font-mono text-xs sm:text-sm leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={stopStream}
                className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-rose-500/60 bg-rose-950/80 px-4 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-900"
                title="Abortar recepción SSE (SIGINT)"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>SIGINT</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-600 px-4 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ejecutar</span>
              </button>
            )}
          </form>
        </div>
      </footer>
    </div>
  );
};

export default App;
