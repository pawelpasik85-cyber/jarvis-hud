#!/usr/bin/env node
/**
 * JARVIS HUD — most między interfejsem w przeglądarce a lokalnym API Cindy.
 *
 * Dlaczego most, a nie bezpośrednie połączenie z przeglądarki?
 * Lokalne API Cindy odrzuca każde zapytanie z nagłówkiem Origin (czyli z przeglądarki),
 * więc rozmowę z Cindy prowadzi ten mały proces Node, a przeglądarka rozmawia tylko z nim.
 *
 * Wymaga Node 22+. Zero zależności.
 * Uruchomienie: node server.mjs   (potem http://127.0.0.1:7777)
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HUD_PORT || 7777);
const HOST = '127.0.0.1';

// ---------- konfiguracja ----------
const DEFAULT_CONFIG = {
  // Folder roboczy, w którym agent ma pracować (np. repozytorium projektu Jarvis).
  cwd: os.homedir(),
  // "client-only" = agent tylko rozmawia, nie dotyka plików ani nie uruchamia poleceń (bezpieczne dla głosu).
  // "native"      = agent może czytać/zmieniać pliki w cwd i uruchamiać polecenia. Włączaj świadomie.
  toolPolicy: 'client-only',
  // Preferowany silnik: "claude-code", "codex" albo "pi". Pusty = pierwszy dostępny model.
  engine: 'claude-code',
  // Konkretny model (id z listy /api/models). Pusty = pierwszy pasujący.
  model: '',
  instructions:
    'Rozmawiasz ze mną głosowo przez interfejs w stylu J.A.R.V.I.S. z Iron Mana. ' +
    'Odpowiadaj po polsku, krótko (zwykle 1–3 zdania), naturalnym językiem mówionym. ' +
    'Bez markdownu, list, tabel i bloków kodu — tekst zostanie przeczytany na głos. ' +
    'Zwracaj się do mnie per "szefie".',
};

async function loadConfig() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(HERE, 'config.json'), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[config] Nie udało się wczytać config.json:', e.message);
    return { ...DEFAULT_CONFIG };
  }
}
const config = await loadConfig();
if (!['client-only', 'native'].includes(config.toolPolicy)) config.toolPolicy = 'client-only';

// ---------- klient lokalnego API Cindy (wg docs/local-agent-api.md, protokół v1) ----------
class CindyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function discoveryCandidates() {
  if (process.env.CINDY_DISCOVERY) return [process.env.CINDY_DISCOVERY];
  const list = [];
  const appdata = process.env.APPDATA;
  if (appdata) {
    list.push(path.join(appdata, 'CindyGlobal', 'local-agent', 'discovery.json'));
    list.push(path.join(appdata, 'Cindy', 'local-agent', 'discovery.json'));
  }
  const home = os.homedir();
  list.push(path.join(home, 'Library', 'Application Support', 'CindyGlobal', 'local-agent', 'discovery.json'));
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  list.push(path.join(xdg, 'CindyGlobal', 'local-agent', 'discovery.json'));
  return list;
}

function parseConnectionCode(input) {
  const m = /^cindy-local:v1:([1-9][0-9]{0,4}):([A-Za-z0-9_-]{43})$/.exec(String(input).trim());
  if (!m || Number(m[1]) > 65535) throw new CindyError('CONNECTION_CODE_INVALID', 'Niepoprawny kod połączenia.');
  return { protocol: 1, port: Number(m[1]), instance: m[2] };
}

async function findEndpoint() {
  if (process.env.CINDY_CONNECTION_CODE) return parseConnectionCode(process.env.CINDY_CONNECTION_CODE);
  for (const file of discoveryCandidates()) {
    try {
      const d = JSON.parse(await fs.readFile(file, 'utf8'));
      if (d.protocol === 1 && Number.isInteger(d.port) && typeof d.instance === 'string') return { ...d, file };
    } catch { /* następny kandydat */ }
  }
  return null;
}

class Cindy {
  #base; #instance; #token; #prefix = randomUUID(); #seq = 0;
  constructor(ep) { this.#base = `http://127.0.0.1:${ep.port}`; this.#instance = ep.instance; }
  get authorized() { return Boolean(this.#token); }

  async request(method, params = {}, timeoutMs) {
    const t = timeoutMs ?? (method === 'capabilities' ? 750 : 30_000);
    let res;
    try {
      res = await fetch(`${this.#base}/rpc`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(t),
        headers: {
          'Content-Type': 'application/json',
          ...(this.#token && method !== 'capabilities' ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
        body: JSON.stringify({ version: 1, instance: this.#instance, id: `${this.#prefix}:${++this.#seq}`, method, params }),
      });
    } catch {
      if (method === 'capabilities') throw new CindyError('CONNECTION_UNAVAILABLE', 'Cindy nie odpowiada.');
      // Nie ponawiamy automatycznie — zapytanie mogło zostać przyjęte.
      throw new CindyError('RESULT_UNKNOWN', `Brak odpowiedzi na "${method}".`);
    }
    let reply;
    try { reply = await res.json(); } catch { throw new CindyError('INVALID_REPLY', 'Niepoprawna odpowiedź Cindy.'); }
    if (reply.error) throw new CindyError(reply.error.code, reply.error.message);
    if (!res.ok || !Object.hasOwn(reply, 'result')) throw new CindyError('INVALID_REPLY', 'Niepoprawna odpowiedź Cindy.');
    if (method === 'capabilities' && (reply.result?.protocol !== 1 || reply.result.instance !== this.#instance)) {
      throw new CindyError('INSTANCE_CHANGED', 'Cindy została zrestartowana — połącz ponownie.');
    }
    return reply.result;
  }

  /** Prosi Cindy o zgodę. Użytkownik musi kliknąć „Zezwól” w oknie Cindy (max 2 min). */
  async pair(identity, onPending) {
    const caps = await this.request('capabilities');
    if (!caps.features?.clientIdentity || !caps.features?.isolatedSessions) {
      throw new CindyError('CAPABILITY_UNSUPPORTED', 'Ta wersja Cindy nie ma ogólnego API dla aplikacji — zaktualizuj Cindy.');
    }
    const pair = await this.request('connect/start', { client: identity });
    onPending?.();
    let claimed = false;
    try {
      const until = Date.now() + 120_000;
      while (Date.now() < until) {
        const r = await this.request('connect/poll', { id: pair.id, claim: pair.claim });
        if (r.state === 'approved' && typeof r.token === 'string') { this.#token = r.token; claimed = true; return; }
        if (r.state === 'denied') throw new CindyError('CONNECTION_DENIED', 'Połączenie odrzucone w Cindy.');
        await delay(250);
      }
      throw new CindyError('PAIR_EXPIRED', 'Minął czas na zatwierdzenie w Cindy.');
    } finally {
      if (!claimed) await this.request('connect/cancel', { id: pair.id, claim: pair.claim }).catch(() => {});
    }
  }

  async revoke() {
    if (!this.#token) return;
    await this.request('connect/revoke').catch(() => {});
    this.#token = undefined;
  }
}

// ---------- stan mostu ----------
const IDENTITY = { id: 'local.jarvis-hud', name: 'JARVIS HUD', version: '0.1' };
const SESSION_ID = 'jarvis-hud';
const state = {
  mode: 'disconnected', // disconnected | pairing | connected | demo
  message: '',
  cindy: null,
  models: [],
  modelId: null,
  sessionOpen: false,
  sessionModel: null,
  busy: false,
};

function publicStatus() {
  const m = state.models.find(x => x.id === state.modelId);
  return {
    mode: state.mode, message: state.message, busy: state.busy,
    model: m ? { id: m.id, label: m.label, provider: m.providerLabel || m.provider, engine: m.engine } : null,
    models: state.models.map(x => ({ id: x.id, label: x.label, provider: x.providerLabel || x.provider, engine: x.engine })),
    toolPolicy: config.toolPolicy, cwd: config.cwd,
  };
}

function pickModel() {
  const byId = config.model && state.models.find(m => m.id === config.model);
  const byEngine = config.engine && state.models.find(m => m.engine === config.engine);
  return (byId || byEngine || state.models[0])?.id ?? null;
}

async function connect() {
  if (state.mode === 'pairing') return;
  const ep = await findEndpoint();
  if (!ep) {
    state.mode = 'disconnected';
    state.message = 'Nie znaleziono uruchomionej Cindy. Włącz Cindy albo użyj trybu demo.';
    return;
  }
  const cindy = new Cindy(ep);
  state.mode = 'pairing';
  state.message = 'Łączenie z Cindy…';
  try {
    await cindy.pair(IDENTITY, () => { state.message = 'Zatwierdź połączenie „JARVIS HUD” w oknie Cindy.'; });
    const { models } = await cindy.request('models');
    state.cindy = cindy;
    state.models = Array.isArray(models) ? models : [];
    state.modelId = pickModel();
    state.sessionOpen = false;
    state.mode = 'connected';
    state.message = state.modelId ? 'Połączono z Cindy.' : 'Połączono, ale Cindy nie ma żadnego dostępnego modelu.';
  } catch (e) {
    state.mode = 'disconnected';
    state.message = `${e.message} (${e.code})`;
  }
}

async function ensureSession() {
  const cindy = state.cindy;
  if (state.sessionOpen && state.sessionModel === state.modelId) return;
  if (state.sessionOpen) {
    await cindy.request('session/close', { sessionId: SESSION_ID }).catch(() => {});
    state.sessionOpen = false;
  }
  await cindy.request('session/open', {
    sessionId: SESSION_ID,
    cwd: path.resolve(config.cwd),
    model: state.modelId,
    toolPolicy: config.toolPolicy,
    instructions: config.instructions,
    tools: [],
  });
  state.sessionOpen = true;
  state.sessionModel = state.modelId;
}

/** Wysyła tekst do Cindy i strumieniuje odpowiedź do callbacka. */
async function askCindy(text, emit, signal) {
  const cindy = state.cindy;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureSession();
      await cindy.request('send', { sessionId: SESSION_ID, parts: [{ type: 'text', text }] });
      break;
    } catch (e) {
      // Sesja wygasa po ~3 min bezczynności — otwieramy nową i próbujemy raz jeszcze.
      if (attempt === 0 && (e.code === 'SESSION_UNAVAILABLE' || e.code === 'RESUME_UNAVAILABLE')) {
        state.sessionOpen = false; continue;
      }
      throw e;
    }
  }
  let cursor = 0;
  for (;;) {
    if (signal.aborted) {
      await cindy.request('interrupt', { sessionId: SESSION_ID }).catch(() => {});
      return;
    }
    const batch = await cindy.request('events', { sessionId: SESSION_ID, cursor });
    for (const { event } of batch.events ?? []) {
      if (event.type === 'text') emit({ type: 'text', data: event.data });
      else if (event.type === 'tool_started') emit({ type: 'tool', data: event.data?.name ?? 'narzędzie' });
      else if (event.type === 'host_tool') {
        // Nie rejestrujemy własnych narzędzi — grzecznie odmawiamy.
        await cindy.request('tool/reply', { sessionId: SESSION_ID, callId: event.data.id, text: 'Narzędzie niedostępne w HUD.', isError: true });
      } else if (event.type === 'turn_end') {
        if (event.data?.status !== 'completed') emit({ type: 'error', data: event.data?.message || `Tura: ${event.data?.status}` });
        return;
      }
    }
    cursor = batch.cursor ?? cursor;
    if (!batch.events?.length) await delay(120);
  }
}

// ---------- tryb demo (bez Cindy) ----------
const DEMO_REPLIES = [
  [/godzin|czas/i, () => `Jest ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}, szefie.`],
  [/kim jeste|przedstaw/i, () => 'Jestem J.A.R.V.I.S., szefie. W tej chwili działam w trybie demonstracyjnym — podłącz Cindy, a dostanę prawdziwy mózg.'],
  [/dzień dobry|cześć|hej|witaj/i, () => 'Witam, szefie. Wszystkie systemy sprawne. W czym mogę pomóc?'],
  [/status|system/i, () => 'Reaktor stabilny, mikrofon aktywny, synteza mowy działa. Brakuje tylko połączenia z Cindy.'],
];
async function askDemo(text, emit, signal) {
  const hit = DEMO_REPLIES.find(([re]) => re.test(text));
  const reply = hit ? hit[1]() : `Usłyszałem: „${text}”. To tryb demo — po podłączeniu Cindy odpowie prawdziwy model.`;
  await delay(500);
  for (const word of reply.split(/(?<= )/)) {
    if (signal.aborted) return;
    emit({ type: 'text', data: word });
    await delay(35);
  }
}

// ---------- serwer HTTP ----------
const STATIC = { '/': 'index.html', '/index.html': 'index.html' };

function sameOrigin(req) {
  // Blokujemy zapytania z obcych stron (np. złośliwa strona w innej karcie próbująca sterować agentem).
  const hostOk = req.headers.host === `${HOST}:${PORT}` || req.headers.host === `localhost:${PORT}`;
  const origin = req.headers.origin;
  const originOk = !origin || origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
  return hostOk && originOk;
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('za duże'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (!sameOrigin(req)) { res.writeHead(403); return res.end('Forbidden'); }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const html = await fs.readFile(path.join(HERE, STATIC[url.pathname]));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, publicStatus());

    if (req.method === 'POST' && url.pathname === '/api/connect') {
      connect(); // w tle — HUD odpytuje /api/status
      return sendJson(res, 202, publicStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/demo') {
      if (state.cindy) { await state.cindy.revoke(); state.cindy = null; }
      Object.assign(state, { mode: 'demo', message: 'Tryb demo — odpowiedzi bez modelu AI.', models: [], modelId: null, sessionOpen: false });
      return sendJson(res, 200, publicStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/model') {
      const { id } = await readJson(req);
      if (!state.models.some(m => m.id === id)) return sendJson(res, 400, { error: 'Nieznany model.' });
      state.modelId = id;
      return sendJson(res, 200, publicStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) return sendJson(res, 400, { error: 'Pusty lub zbyt długi tekst.' });
      if (state.mode !== 'connected' && state.mode !== 'demo') return sendJson(res, 409, { error: 'Brak połączenia z Cindy.' });
      if (state.mode === 'connected' && !state.modelId) return sendJson(res, 409, { error: 'Brak dostępnego modelu w Cindy.' });
      if (state.busy) return sendJson(res, 409, { error: 'Poprzednie polecenie jeszcze trwa.' });

      state.busy = true;
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const emit = obj => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };
      try {
        await (state.mode === 'demo' ? askDemo : askCindy)(text.trim(), emit, ac.signal);
        emit({ type: 'done' });
      } catch (e) {
        if (e.code === 'UNAUTHORIZED' || e.code === 'INSTANCE_CHANGED') {
          state.mode = 'disconnected'; state.cindy = null; state.sessionOpen = false;
          state.message = 'Utracono połączenie z Cindy — połącz ponownie.';
        }
        emit({ type: 'error', data: `${e.message}${e.code ? ` (${e.code})` : ''}` });
      } finally {
        state.busy = false;
        res.end();
      }
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  }
});

async function shutdown() {
  console.log('\nZamykanie…');
  if (state.cindy) {
    if (state.sessionOpen) await state.cindy.request('session/close', { sessionId: SESSION_ID }).catch(() => {});
    await state.cindy.revoke();
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`J.A.R.V.I.S. HUD: http://${HOST}:${PORT}`);
  console.log(`Folder roboczy agenta: ${config.cwd}  |  uprawnienia: ${config.toolPolicy}`);
  if (process.env.HUD_NO_AUTOCONNECT !== '1') connect();
  if (process.env.HUD_OPEN === '1' && process.platform === 'win32') {
    // Edge w trybie aplikacji (bez pasków), a gdy go nie ma — domyślna przeglądarka.
    const url = `http://${HOST}:${PORT}`;
    const child = spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${url}`], { detached: true, stdio: 'ignore' });
    child.on('exit', code => { if (code) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); });
    child.unref();
  }
});
