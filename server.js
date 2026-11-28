#!/usr/bin/env node
// FreeLLM proxy: Anthropic Messages API in  ->  free OpenAI-compatible providers out.
// Auto-failover when a provider hits its limit, with a handoff note for the next model.
// Zero dependencies. Node 18+.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.FREELLM_CONFIG || path.join(__dirname, 'providers.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const PORT = Number(process.env.PORT || cfg.port || 8787);
const COOLDOWN_MS = cfg.cooldownMs || 60000;
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';
const LOG = process.env.QUIET ? () => {} : (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- providers
const providers = cfg.providers
  .map((p) => {
    const keys = (process.env[p.keyEnv] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return {
      ...p,
      baseUrl: process.env[`${p.keyEnv}_BASE_URL`] || p.baseUrl,
      keys,
      keyIdx: 0,
      cooldownUntil: 0,
      reqTimes: [],
      tokensToday: 0,
      day: new Date().toDateString(),
      stats: { requests: 0, failures: 0, inTokens: 0, outTokens: 0 },
    };
  })
  .filter((p) => p.keys.length > 0);

let current = null; // name of provider that served the last request
let handoff = null; // { note, from, to, at }

function providerAvailable(p, now) {
  if (p.cooldownUntil > now) return false;
  if (p.day !== new Date().toDateString()) { p.day = new Date().toDateString(); p.tokensToday = 0; }
  if (p.tokensPerDay && p.tokensToday >= p.tokensPerDay) return false;
  p.reqTimes = p.reqTimes.filter((t) => now - t < 60000);
  if (p.rpm && p.reqTimes.length >= p.rpm) return false;
  return true;
}
function pickKey(p) { const k = p.keys[p.keyIdx % p.keys.length]; return k; }
function cool(p, ms, why) {
  // with several keys, rotate key first; cool the whole provider only when all keys were tried
  if (p.keys.length > 1 && !p._rotatedAll) {
    p.keyIdx++; p._rot = (p._rot || 0) + 1;
    if (p._rot < p.keys.length) { LOG(`[${p.name}] ${why} -> next key`); return; }
    p._rot = 0;
  }
  p.cooldownUntil = Date.now() + ms;
  LOG(`[${p.name}] ${why} -> cooldown ${Math.round(ms / 1000)}s`);
}

// ---------------------------------------------------------------- helpers
const textOf = (c) => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? textOf(b.content) : '')).join('') : '';
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const estTokens = (obj) => Math.ceil(JSON.stringify(obj).length / 3.5);

function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (s && typeof s === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === '$schema' || k === 'additionalProperties' || k === 'propertyNames' || k === '$id') continue;
      o[k] = cleanSchema(v);
    }
    return o;
  }
  return s;
}

// ---------------------------------------------------------------- handoff note
function buildHandoff(body, from, to, reason) {
  const msgs = body.messages || [];
  const firstUser = msgs.find((m) => m.role === 'user');
  const goal = clip(textOf(firstUser && firstUser.content).trim(), 400);
  const actions = [];
  for (const m of msgs) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_use') continue;
      const i = b.input || {};
      const target = i.file_path || i.path || i.command || i.pattern || i.url || '';
      actions.push(`${b.name}${target ? ': ' + clip(String(target), 90) : ''}`);
    }
  }
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && textOf(m.content).trim());
  const lines = [
    `HANDOFF NOTE (model switched: ${from || 'n/a'} -> ${to}, reason: ${reason}).`,
    `You are continuing a session that a previous model started. Do not restart; pick up where it stopped.`,
    `GOAL: ${goal || '(see conversation)'}`,
    `DONE (last ${Math.min(actions.length, 10)} actions): ${actions.slice(-10).join(' | ') || 'none yet'}`,
    `LAST ASSISTANT MESSAGE: ${clip(textOf(lastAssistant && lastAssistant.content).trim(), 300) || '(tool call)'}`,
    `NEXT: continue the latest request -> ${clip(textOf(lastUser && lastUser.content).trim(), 300) || '(see conversation)'}`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------- Anthropic -> OpenAI
function toOpenAI(body, p, handoffNote) {
  const messages = [];
  let sys = textOf(body.system);
  if (handoffNote) sys = (sys ? sys + '\n\n' : '') + handoffNote;
  if (sys) messages.push({ role: 'system', content: sys });

  for (const m of body.messages || []) {
    if (typeof m.content === 'string') { messages.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
      }));
      const msg = { role: 'assistant', content: text || (calls.length ? null : '') };
      if (calls.length) msg.tool_calls = calls;
      messages.push(msg);
    } else {
      const results = m.content.filter((b) => b.type === 'tool_result');
      for (const r of results) {
        messages.push({ role: 'tool', tool_call_id: r.tool_use_id, content: textOf(r.content) || (r.is_error ? 'error' : 'ok') });
      }
      const parts = [];
      for (const b of m.content) {
        if (b.type === 'text') parts.push({ type: 'text', text: b.text });
        else if (b.type === 'image' && b.source && b.source.type === 'base64')
          parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      }
      if (parts.length) messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
    }
  }

  const out = {
    model: p.model,
    messages: fitContext(messages, p),
    max_tokens: Math.min(body.max_tokens || p.maxOutput || 4096, p.maxOutput || 8192),
    stream: !!body.stream,
  };
  if (body.stream) out.stream_options = { include_usage: true };
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.top_p != null) out.top_p = body.top_p;
  if (body.stop_sequences && body.stop_sequences.length) out.stop = body.stop_sequences;
  if (body.tools && body.tools.length) {
    out.tools = body.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description || '', parameters: cleanSchema(t.input_schema || { type: 'object', properties: {} }) },
    }));
    const tc = body.tool_choice;
    if (tc) out.tool_choice = tc.type === 'any' ? 'required' : tc.type === 'none' ? 'none'
      : tc.type === 'tool' ? { type: 'function', function: { name: tc.name } } : 'auto';
  }
  return out;
}

// shrink old, big tool results when the next provider has a smaller window
function fitContext(messages, p) {
  const limit = Math.floor((p.contextTokens || 100000) * 0.8);
  let total = estTokens(messages);
  if (total <= limit) return messages;
  const out = messages.map((m) => ({ ...m }));
  for (let i = 0; i < out.length - 4 && total > limit; i++) {
    const m = out[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 600) {
      const before = m.content.length;
      m.content = m.content.slice(0, 300) + '\n…[trimmed to fit context]…\n' + m.content.slice(-200);
      total -= Math.ceil((before - m.content.length) / 3.5);
    }
  }
  // still too big: drop oldest non-system turns, keeping tool-call pairs intact by dropping until a user turn
  while (total > limit && out.length > 6) {
    const idx = out.findIndex((m) => m.role !== 'system');
    let end = idx + 1;
    while (end < out.length - 4 && out[end].role !== 'user') end++;
    const removed = out.splice(idx, end - idx);
    total -= estTokens(removed);
  }
  return out;
}

// ---------------------------------------------------------------- OpenAI -> Anthropic
const STOP = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'end_turn' };
const msgId = () => 'msg_' + Math.random().toString(36).slice(2, 14);

function fromOpenAI(j, reqModel) {
  const ch = (j.choices && j.choices[0]) || {};
  const m = ch.message || {};
  const content = [];
  if (m.content) content.push({ type: 'text', text: m.content });
  for (const tc of m.tool_calls || []) {
    let input = {};
    try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep {} */ }
    content.push({ type: 'tool_use', id: tc.id || 'toolu_' + Math.random().toString(36).slice(2, 10), name: tc.function.name, input });
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  return {
    id: msgId(), type: 'message', role: 'assistant', model: reqModel, content,
    stop_reason: STOP[ch.finish_reason] || 'end_turn', stop_sequence: null,
    usage: { input_tokens: (j.usage && j.usage.prompt_tokens) || 0, output_tokens: (j.usage && j.usage.completion_tokens) || 0 },
  };
}

async function streamToAnthropic(upstream, res, reqModel, p) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: msgId(), type: 'message', role: 'assistant', model: reqModel, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });

  let idx = -1, open = null; // open: 'text' | 'tool'
  const toolMap = new Map(); // openai tool index -> anthropic block index
  let finish = null, usage = { prompt_tokens: 0, completion_tokens: 0 };
  const closeBlock = () => { if (open) { send('content_block_stop', { type: 'content_block_stop', index: idx }); open = null; } };

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of upstream.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.usage) usage = j.usage;
      const ch = j.choices && j.choices[0];
      if (!ch) continue;
      const d = ch.delta || {};
      if (d.content) {
        if (open !== 'text') { closeBlock(); idx++; open = 'text'; send('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } }); }
        send('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: d.content } });
      }
      for (const tc of d.tool_calls || []) {
        const k = tc.index != null ? tc.index : 0;
        if (!toolMap.has(k) || (tc.id && toolMap.get(k).id !== tc.id && toolMap.get(k).started)) {
          closeBlock(); idx++; open = 'tool';
          toolMap.set(k, { idx, id: tc.id, started: true });
          send('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: tc.id || 'toolu_' + Math.random().toString(36).slice(2, 10), name: (tc.function && tc.function.name) || '', input: {} } });
        }
        const args = tc.function && tc.function.arguments;
        if (args) send('content_block_delta', { type: 'content_block_delta', index: toolMap.get(k).idx, delta: { type: 'input_json_delta', partial_json: args } });
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  closeBlock();
  if (idx < 0) { send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); send('content_block_stop', { type: 'content_block_stop', index: 0 }); }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: STOP[finish] || (toolMap.size ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: usage.completion_tokens || 0 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
  return usage;
}

// ---------------------------------------------------------------- core: try providers in order
async function handleMessages(body, res) {
  const reqModel = body.model || 'claude-sonnet-4-5';
  const now = Date.now();
  // priority = config order; skip those cooling down / over budget
  let candidates = providers.filter((p) => providerAvailable(p, now));
  if (!candidates.length) candidates = providers.slice().sort((a, b) => a.cooldownUntil - b.cooldownUntil).slice(0, 1);
  if (!candidates.length) return sendJson(res, 500, errBody('No providers configured. Set at least one API key env var.'));

  let lastErr = 'no provider tried';
  let reason = null;
  for (const p of candidates) {
    const switched = current && current !== p.name;
    if (switched) {
      handoff = { note: buildHandoff(body, current, p.name, reason || 'previous provider unavailable'), from: current, to: p.name, at: Date.now() };
      LOG(`SWITCH ${current} -> ${p.name}`);
    }
    // a short conversation means a fresh session: drop stale note
    if ((body.messages || []).length <= 2 && !switched) handoff = null;

    p.reqTimes.push(Date.now()); p.stats.requests++;
    let upstream;
    try {
      upstream = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${pickKey(p)}` },
        body: JSON.stringify(toOpenAI(body, p, handoff && handoff.to === p.name ? handoff.note : null)),
        signal: AbortSignal.timeout(Number(process.env.UPSTREAM_TIMEOUT_MS || 120000)),
      });
    } catch (e) {
      p.stats.failures++; cool(p, 30000, `network error: ${e.message}`); lastErr = `${p.name}: ${e.message}`; reason = 'network error'; continue;
    }
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => '');
      p.stats.failures++; lastErr = `${p.name} ${upstream.status}: ${clip(txt, 200)}`;
      if (upstream.status === 429 || /quota|rate.?limit|exhaust/i.test(txt)) {
        const ra = Number(upstream.headers.get('retry-after'));
        cool(p, ra ? ra * 1000 : COOLDOWN_MS, `limit reached (${upstream.status})`); reason = 'rate limit reached';
      } else if (upstream.status === 401 || upstream.status === 403) {
        cool(p, 10 * 60000, `auth failed (${upstream.status})`); reason = 'auth failed';
      } else if (upstream.status >= 500) {
        cool(p, 30000, `server error ${upstream.status}`); reason = 'server error';
      } else if (upstream.status === 400 || upstream.status === 404 || upstream.status === 422) {
        // our request isn't accepted by this provider (schema/model); try next but don't cool long
        cool(p, 15000, `bad request ${upstream.status}: ${clip(txt, 120)}`); reason = 'request rejected';
      } else { reason = `status ${upstream.status}`; }
      continue;
    }
    // success
    let usage;
    try {
      if (body.stream) usage = await streamToAnthropic(upstream, res, reqModel, p);
      else {
        const j = await upstream.json();
        const out = fromOpenAI(j, reqModel);
        usage = j.usage || {};
        sendJson(res, 200, out);
      }
    } catch (e) {
      LOG(`[${p.name}] stream broke: ${e.message}`);
      if (!res.headersSent) { cool(p, 30000, 'broken response'); lastErr = e.message; reason = 'broken response'; continue; }
      try { res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: e.message } })}\n\n`); res.end(); } catch { /* ignore */ }
      return;
    }
    const used = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    p.tokensToday += used; p.stats.inTokens += usage.prompt_tokens || 0; p.stats.outTokens += usage.completion_tokens || 0;
    p._rot = 0;
    current = p.name;
    return;
  }
  sendJson(res, 529, errBody(`All providers failed. Last: ${lastErr}`, 'overloaded_error'));
}

const errBody = (message, type = 'api_error') => ({ type: 'error', error: { type, message } });
function sendJson(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (PROXY_TOKEN && url !== '/status') {
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
    if (tok !== PROXY_TOKEN) return sendJson(res, 401, errBody('bad proxy token', 'authentication_error'));
  }
  if (req.method === 'GET' && url === '/status') {
    const now = Date.now();
    return sendJson(res, 200, {
      current, lastHandoff: handoff && { from: handoff.from, to: handoff.to, at: new Date(handoff.at).toISOString() },
      providers: providers.map((p) => ({
        name: p.name, model: p.model, available: providerAvailable(p, now),
        cooldownSec: Math.max(0, Math.round((p.cooldownUntil - now) / 1000)),
        tokensToday: p.tokensToday, ...p.stats,
      })),
    });
  }
  if (req.method !== 'POST') return sendJson(res, 404, errBody('not found', 'not_found_error'));
  let raw = '';
  for await (const c of req) raw += c;
  let body;
  try { body = JSON.parse(raw); } catch { return sendJson(res, 400, errBody('invalid json', 'invalid_request_error')); }
  if (url === '/v1/messages/count_tokens') return sendJson(res, 200, { input_tokens: estTokens(body) });
  if (url === '/v1/messages') return handleMessages(body, res).catch((e) => { LOG('fatal', e); if (!res.headersSent) sendJson(res, 500, errBody(e.message)); else res.end(); });
  sendJson(res, 404, errBody('not found', 'not_found_error'));
});

module.exports = { server, providers, toOpenAI, fromOpenAI, buildHandoff };
if (require.main === module) {
  if (!providers.length) console.error('WARNING: no API keys found. Set e.g. GEMINI_API_KEY, ZAI_API_KEY, QWEN_API_KEY, MISTRAL_API_KEY, NVIDIA_API_KEY');
  server.listen(PORT, () => {
    console.log(`FreeLLM proxy on http://localhost:${PORT}  providers: ${providers.map((p) => p.name).join(' -> ') || 'none'}`);
    console.log(`Claude Code:  ANTHROPIC_BASE_URL=http://localhost:${PORT} ANTHROPIC_AUTH_TOKEN=${PROXY_TOKEN || 'x'} claude`);
  });
}
