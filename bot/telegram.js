// Minimal Telegram Bot API client.
//
// Long polling, not webhooks: a webhook needs a public HTTPS URL, and this runs beside a
// PocketBase on localhost. Polling reaches out rather than being reached, so the setup
// stays entirely local — no tunnel, no certificate, nothing exposed.
//
// No dependencies. Node has fetch, FormData and Blob built in.

const API = 'https://api.telegram.org';

export class TelegramError extends Error {
  constructor(method, body) {
    super(`Telegram ${method} failed: ${body?.description || 'unknown error'}`);
    this.name = 'TelegramError';
    this.code = body?.error_code;
  }
}

export function createClient(token, { fetchImpl = fetch } = {}) {
  if (!token) throw new Error('A bot token is required.');

  async function call(method, params = {}, { timeoutMs } = {}) {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      // Long polling holds the request open; give it longer than the poll itself.
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const body = await res.json().catch(() => null);
    if (!body?.ok) throw new TelegramError(method, body);
    return body.result;
  }

  return {
    /** Who the bot is — also the first proof the token works. */
    getMe: () => call('getMe'),

    /**
     * Wait for messages. Telegram holds the connection open until something arrives or
     * `seconds` elapse, so this is a blocking call by design, not a busy loop.
     */
    getUpdates: (offset, seconds = 50) =>
      call('getUpdates', {
        offset,
        timeout: seconds,
        allowed_updates: ['message'],
      }, { timeoutMs: (seconds + 15) * 1000 }),

    sendMessage: (chatId, text) =>
      call('sendMessage', { chat_id: chatId, text, disable_notification: true }),

    /**
     * Download a file by id. Two steps: ask where it lives, then fetch it.
     *
     * Retried, because a dropped connection here costs the parent the memory itself —
     * the post is already written by the time this runs, so a failure leaves a caption
     * with nothing attached. Phone clips are several MB and this runs on a home
     * connection; `fetch failed` from a momentary blip is the common case, not a bug in
     * the file. A 4xx is not retried: asking again for something Telegram has refused or
     * expired only delays the report.
     */
    async downloadFile(fileId, { attempts = 3 } = {}) {
      const { file_path: path } = await call('getFile', { file_id: fileId });
      let last;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const res = await fetchImpl(`${API}/file/bot${token}/${path}`, {
            signal: AbortSignal.timeout(120000), // a hung socket must not stall the bot
          });
          if (!res.ok) {
            const err = new Error(`Could not download ${path}: ${res.status}`);
            if (res.status >= 400 && res.status < 500) throw err;
            throw Object.assign(err, { retry: true });
          }
          return {
            blob: await res.blob(),
            filename: path.split('/').pop() || `${fileId}.jpg`,
          };
        } catch (err) {
          last = err;
          const worthRetrying = err.retry || err.name === 'TimeoutError'
            || err.name === 'TypeError'; // undici reports a dropped connection this way
          if (!worthRetrying || attempt === attempts) break;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      throw last;
    },
  };
}
