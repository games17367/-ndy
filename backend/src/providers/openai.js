// OpenAI-kompatible Chat-Completions-API (OpenAI, Groq, OpenRouter, Mistral, lokale Server ...)
// Streaming + Werkzeugnutzung.

import { fetchWithTimeout, parseSse } from '../http-utils.js';
import { ProviderError } from './anthropic.js';

function friendlyError(status, apiMessage) {
  if (status === 401 || status === 403) return new ProviderError('auth', 'Der KI-Schlüssel auf dem Server ist ungültig oder hat keine Berechtigung.', status);
  if (status === 429) return new ProviderError('busy', 'Die KI ist gerade überlastet oder das Kontingent ist aufgebraucht. Versuch es gleich noch mal.', status);
  if (status >= 500) return new ProviderError('upstream', 'Die KI hat gerade einen Schluckauf. Versuch es gleich noch mal.', status);
  return new ProviderError('bad_request', `Die KI hat die Anfrage abgelehnt${apiMessage ? `: ${apiMessage}` : '.'}`, status);
}

export function toWireMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant' && !m.toolCalls?.length) out.push({ role: 'assistant', content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        })),
      });
    } else if (m.role === 'tool') {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.text });
    }
  }
  return out;
}

export function createOpenAiProvider(config) {
  const cfg = config.openai;
  return {
    name: cfg.label || 'openai',
    model: cfg.chatModel,

    async stream({ system, messages, tools, onText, signal }) {
      const body = {
        model: cfg.chatModel,
        max_tokens: cfg.maxTokens,
        messages: toWireMessages(system, messages),
        stream: true,
      };
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        }));
      }

      let res;
      try {
        res = await fetchWithTimeout(
          `${cfg.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify(body),
          },
          config.requestTimeoutMs,
          signal
        );
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new ProviderError('network', 'Ich erreiche die KI gerade nicht.');
      }
      if (!res.ok) {
        let apiMessage = '';
        try {
          apiMessage = (await res.json())?.error?.message || '';
        } catch {
          /* ignorieren */
        }
        throw friendlyError(res.status, apiMessage);
      }

      let text = '';
      const calls = new Map(); // index -> {id,name,json}
      let stopReason = null;

      for await (const evt of parseSse(res.body)) {
        if (evt.data === '[DONE]') break;
        let data;
        try {
          data = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const choice = data.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) {
          text += delta.content;
          onText?.(delta.content);
        }
        for (const tc of delta.tool_calls || []) {
          const entry = calls.get(tc.index) || { id: '', name: '', json: '' };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.json += tc.function.arguments;
          calls.set(tc.index, entry);
        }
        if (choice.finish_reason) stopReason = choice.finish_reason;
      }

      const toolCalls = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, c], i) => {
          let input = {};
          try {
            input = c.json ? JSON.parse(c.json) : {};
          } catch {
            input = {};
          }
          return { id: c.id || `call_${i}`, name: c.name, input };
        })
        .filter((c) => c.name);

      return { text, toolCalls, stopReason, usage: {} };
    },
  };
}
