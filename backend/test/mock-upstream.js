// Gefälschte Upstream-Dienste für Tests: Anthropic, OpenAI, Open-Meteo, Brave, Wikipedia.
// So lässt sich das ganze Backend ohne echte API-Schlüssel und ohne Internet testen.

import http from 'node:http';

export function startMockUpstream() {
  const requests = [];

  const sse = (res, events) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  };

  const anthropicText = (chunks, stop = 'end_turn') => [
    ['message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...chunks.map((t) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];

  const anthropicTool = (preText, name, input, id = 'toolu_1') => [
    ['message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: preText } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name, input: {} } }],
    // JSON bewusst in Stücken, um das Zusammensetzen zu testen
    ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 7) } }],
    ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(7) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 1 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }],
    ['message_stop', { type: 'message_stop' }],
  ];

  const lastUserText = (messages) => {
    const m = messages[messages.length - 1];
    if (typeof m.content === 'string') return { text: m.content, hasToolResult: false };
    return { text: '', hasToolResult: m.content.some((b) => b.type === 'tool_result') };
  };
  const firstUserText = (messages) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && typeof messages[i].content === 'string') return messages[i].content;
    }
    return '';
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    let body = null;
    if ((req.headers['content-type'] || '').includes('json')) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        body = null;
      }
    }
    requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body, rawLength: raw.length });

    // ---- Anthropic ----
    if (url.pathname === '/v1/messages') {
      if (req.headers['x-api-key'] === 'bad-key') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      }
      const { text, hasToolResult } = lastUserText(body.messages);
      const q = (hasToolResult ? firstUserText(body.messages) : text).toLowerCase();
      if (hasToolResult) return sse(res, anthropicText(['Erledigt, ', 'sagt Ändy.']));
      if (q.includes('wetter')) return sse(res, anthropicTool('Moment, ich schau nach. ', 'get_weather', { location: 'Wien' }));
      if (q.includes('suche')) return sse(res, anthropicTool('', 'web_search', { query: 'Hundertwasserhaus' }));
      if (q.includes('rechne')) return sse(res, anthropicTool('', 'calculate', { expression: '(12.5+7.5)*3' }));
      if (q.includes('timer')) return sse(res, anthropicTool('Läuft. ', 'set_timer', { seconds: 300, label: 'Nudeln' }));
      const tomorrow = (h) => { const d = new Date(Date.now() + 86400000); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(h)}:00`; };
      if (q.includes('termin')) return sse(res, anthropicTool('Mach ich. ', 'create_calendar_event', { title: 'Zahnarzt', start: tomorrow(9), location: 'Wien' }));
      if (q.includes('route')) return sse(res, anthropicTool('', 'start_navigation', { destination: 'Stephansdom Wien', mode: 'walking' }));
      if (q.includes('musik')) return sse(res, anthropicTool('', 'play_music', { query: 'Falco Rock Me Amadeus', service: 'spotify' }));
      if (q.includes('nachricht')) return sse(res, anthropicTool('', 'compose_message', { channel: 'whatsapp', body: 'Bin gleich da!', recipient: '+43 660 1234567' }));
      if (q.includes('notiere')) return sse(res, anthropicTool('', 'create_note', { text: 'Milch kaufen' }));
      if (q.includes('erinnere')) return sse(res, anthropicTool('', 'add_reminder', { text: 'Mama anrufen', when: tomorrow(8) }));
      if (q.includes('kaputt')) return sse(res, anthropicTool('', 'set_timer', { seconds: -5 }));
      return sse(res, anthropicText(['Sarvus! ', 'Was geht ab?']));
    }

    // ---- OpenAI (unter /openai) ----
    if (url.pathname === '/openai/chat/completions') {
      const msgs = body.messages;
      const last = msgs[msgs.length - 1];
      const delta = (d, finish = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const w = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (last.role === 'tool') {
        w(delta({ content: 'Fertig ' }));
        w(delta({ content: 'vom Mock.' }));
        w(delta({}, 'stop'));
      } else if (String(last.content).toLowerCase().includes('timer')) {
        w(delta({ content: 'Okay. ' }));
        w(delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'set_timer', arguments: '' } }] }));
        w(delta({ tool_calls: [{ index: 0, function: { arguments: '{"seconds":' } }] }));
        w(delta({ tool_calls: [{ index: 0, function: { arguments: '60}' } }] }));
        w(delta({}, 'tool_calls'));
      } else {
        w(delta({ content: 'Hallo ' }));
        w(delta({ content: 'von OpenAI-Mock.' }));
        w(delta({}, 'stop'));
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (url.pathname === '/openai/audio/transcriptions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ text: 'Sarvus Ändy wie spät ist es' }));
    }
    if (url.pathname === '/openai/audio/speech') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      return res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]));
    }

    // ---- Open-Meteo ----
    if (url.pathname === '/v1/search') {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (url.searchParams.get('name') === 'Nirgendwo') return res.end(JSON.stringify({}));
      return res.end(JSON.stringify({ results: [{ name: 'Wien', admin1: 'Wien', country: 'Österreich', latitude: 48.2, longitude: 16.37 }] }));
    }
    if (url.pathname === '/v1/forecast') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          current: { temperature_2m: 12.4, apparent_temperature: 10.9, relative_humidity_2m: 71, precipitation: 0, weather_code: 3, wind_speed_10m: 14.2 },
          daily: {
            time: ['2026-11-17', '2026-11-18', '2026-11-19'],
            weather_code: [3, 61, 0],
            temperature_2m_max: [13.1, 11.2, 9.8],
            temperature_2m_min: [6.0, 7.5, 3.1],
            precipitation_probability_max: [10, 80, 5],
          },
        })
      );
    }

    // ---- Brave ----
    if (url.pathname === '/res/v1/web/search') {
      if (req.headers['x-subscription-token'] === 'fail') {
        res.writeHead(500);
        return res.end('boom');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          web: { results: [{ title: 'Hundertwasserhaus Wien', url: 'https://www.wien.info/hundertwasser', description: 'Das <strong>Hundertwasserhaus</strong> ist ein Wohnhaus.' }] },
        })
      );
    }

    // ---- Wikipedia ----
    if (url.pathname === '/w/api.php') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({ query: { pages: { 1: { index: 1, title: 'Hundertwasserhaus', extract: 'Das Hundertwasserhaus ist ein Gebäude in Wien.' } } } })
      );
    }

    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
