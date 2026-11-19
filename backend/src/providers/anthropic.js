// Anthropic Messages API mit Streaming und Werkzeugnutzung.

import { fetchWithTimeout, parseSse } from '../http-utils.js';

export class ProviderError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function friendlyError(status, apiMessage) {
  if (status === 401 || status === 403) return new ProviderError('auth', 'Der KI-Schlüssel auf dem Server ist ungültig oder hat keine Berechtigung.', status);
  if (status === 429) return new ProviderError('busy', 'Die KI ist gerade überlastet oder das Kontingent ist aufgebraucht. Versuch es gleich noch mal.', status);
  if (status === 529 || status >= 500) return new ProviderError('upstream', 'Die KI hat gerade einen Schluckauf. Versuch es gleich noch mal.', status);
  return new ProviderError('bad_request', `Die KI hat die Anfrage abgelehnt${apiMessage ? `: ${apiMessage}` : '.'}`, status);
}

/** Kanonisches Nachrichtenformat → Anthropic-Format. */
export function toWireMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant' && !m.toolCalls?.length) {
      out.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      out.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.text,
          ...(r.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  return out;
}

export function createAnthropicProvider(config) {
  const cfg = config.anthropic;
  return {
    name: 'anthropic',
    model: cfg.model,

    /**
     * Ein Modell-Durchlauf. Streamt Text über onText und liefert {text, toolCalls}.
     */
    async stream({ system, messages, tools, onText, signal }) {
      const body = {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system,
        messages: toWireMessages(messages),
        stream: true,
      };
      if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

      let res;
      try {
        res = await fetchWithTimeout(
          `${cfg.baseUrl}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': cfg.apiKey,
              'anthropic-version': '2023-06-01',
            },
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
      const blocks = new Map(); // index -> {type,id,name,json}
      let stopReason = null;
      let usage = {};

      for await (const evt of parseSse(res.body)) {
        let data;
        try {
          data = JSON.parse(evt.data);
        } catch {
          continue;
        }
        switch (data.type) {
          case 'message_start':
            usage = { ...usage, input: data.message?.usage?.input_tokens };
            break;
          case 'content_block_start': {
            const b = data.content_block || {};
            blocks.set(data.index, { type: b.type, id: b.id, name: b.name, json: '' });
            break;
          }
          case 'content_block_delta': {
            const d = data.delta || {};
            if (d.type === 'text_delta' && d.text) {
              text += d.text;
              onText?.(d.text);
            } else if (d.type === 'input_json_delta') {
              const b = blocks.get(data.index);
              if (b) b.json += d.partial_json || '';
            }
            break;
          }
          case 'message_delta':
            stopReason = data.delta?.stop_reason || stopReason;
            usage = { ...usage, output: data.usage?.output_tokens };
            break;
          case 'error':
            throw friendlyError(data.error?.type === 'overloaded_error' ? 529 : 500, data.error?.message);
          default:
            break;
        }
      }

      const toolCalls = [];
      for (const b of [...blocks.entries()].sort((a, c) => a[0] - c[0]).map((e) => e[1])) {
        if (b.type !== 'tool_use') continue;
        let input = {};
        try {
          input = b.json ? JSON.parse(b.json) : {};
        } catch {
          input = {};
        }
        toolCalls.push({ id: b.id, name: b.name, input });
      }
      return { text, toolCalls, stopReason, usage };
    },
  };
}
