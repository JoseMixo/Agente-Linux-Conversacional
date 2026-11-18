export interface SseStreamOptions {
  endpoint: string;
  prompt: string;
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onComplete: () => void;
  onError?: (err: Error) => void;
}

/**
 * Consume un flujo Server-Sent Events (SSE) en tiempo real.
 * Soporta tanto `EventSource` nativo (para prompts cortos vía GET) como
 * `fetch` con `Accept: text/event-stream` (para pegados masivos de logs de systemd/InfluxDB).
 */
export async function consumeSseStream({
  endpoint,
  prompt,
  signal,
  onToken,
  onComplete,
  onError,
}: SseStreamOptions): Promise<void> {
  // Si el prompt es corto (< 1500 caracteres) y el endpoint es relativo o soporta GET,
  // podemos usar EventSource nativo o stream SSE por POST para logs masivos.
  const canUseNativeEventSource =
    typeof window !== 'undefined' &&
    'EventSource' in window &&
    prompt.length < 1500 &&
    endpoint.startsWith('/');

  if (canUseNativeEventSource) {
    try {
      await consumeWithNativeEventSource({ endpoint, prompt, signal, onToken, onComplete });
      return;
    } catch {
      // Si EventSource falla (ej. requiere POST), cae de inmediato al parser SSE sobre ReadableStream
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ prompt }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}: No se pudo abrir el canal SSE en ${endpoint}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const rawEvent of events) {
        const lines = rawEvent.split(/\r?\n/);
        let eventType = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        const dataPayload = dataLines.join('\n');
        if (!dataPayload) continue;

        if (eventType === 'done' || dataPayload === '[DONE]') {
          onComplete();
          return;
        }

        try {
          const parsed = JSON.parse(dataPayload) as { token?: string; content?: string; text?: string };
          const token = parsed.token ?? parsed.content ?? parsed.text ?? '';
          if (token) onToken(token);
        } catch {
          onToken(dataPayload);
        }
      }
    }

    onComplete();
  } catch (err) {
    if (signal?.aborted) {
      onComplete();
      return;
    }
    if (onError && err instanceof Error) {
      onError(err);
    }
  }
}

function consumeWithNativeEventSource({
  endpoint,
  prompt,
  signal,
  onToken,
  onComplete,
}: SseStreamOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${endpoint}?prompt=${encodeURIComponent(prompt)}`;
    const es = new EventSource(url);
    let receivedAnyData = false;

    const cleanup = () => {
      es.close();
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        cleanup();
        onComplete();
        resolve();
      });
    }

    es.onmessage = (event) => {
      receivedAnyData = true;
      if (event.data === '[DONE]') {
        cleanup();
        onComplete();
        resolve();
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as { token?: string; content?: string };
        const token = parsed.token ?? parsed.content ?? '';
        if (token) onToken(token);
      } catch {
        onToken(event.data);
      }
    };

    es.addEventListener('done', () => {
      cleanup();
      onComplete();
      resolve();
    });

    es.onerror = () => {
      cleanup();
      if (receivedAnyData) {
        onComplete();
        resolve();
      } else {
        reject(new Error('EventSource connection failed'));
      }
    };
  });
}
