// Die Gesprächsschleife: Modell → (Werkzeuge ausführen) → Modell ... bis eine Antwort steht.

import { runTool, isServerTool } from './tools.js';
import { cleanText } from './persona.js';

const MAX_HISTORY = 30;
const MAX_MESSAGE_CHARS = 4000;

/** Bereinigt den vom Client gesendeten Verlauf. */
export function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS).trim() }))
    .filter((m) => m.content)
    .slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

export async function runChat({ provider, system, history, tools, context, config, emit, signal, maxSteps = 5 }) {
  const messages = [...history];
  let finalText = '';
  let totalUsage = {};

  for (let step = 0; step < maxSteps; step++) {
    let stepText = '';
    const result = await provider.stream({
      system,
      messages,
      tools,
      signal,
      onText: (delta) => {
        stepText += delta;
        emit('text', { delta });
      },
    });
    finalText += stepText;
    totalUsage = result.usage || totalUsage;

    if (!result.toolCalls.length) break;

    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

    const results = [];
    for (const call of result.toolCalls) {
      if (isServerTool(call.name)) emit('status', { phase: 'tool', name: call.name });
      const out = await runTool(call.name, call.input, { config, context, signal });

      if (out.kind === 'action') {
        emit('action', { id: call.id, name: call.name, input: out.input });
        results.push({ id: call.id, text: out.text });
      } else if (out.kind === 'result') {
        if (out.card) emit('card', out.card);
        results.push({ id: call.id, text: out.text });
      } else {
        results.push({ id: call.id, text: out.text, isError: true });
      }
    }
    messages.push({ role: 'tool', results });

    // Zeigt, dass der Text bis hierhin endgültig ist (z. B. „Ich schau mal nach.“)
    if (step === maxSteps - 1) break;
  }

  emit('done', { text: cleanText(finalText, 8000), usage: totalUsage });
  return finalText;
}
