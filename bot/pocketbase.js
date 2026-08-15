// PocketBase client for the bot.
//
// Deliberately separate from js/pb.js: that one persists its token in localStorage and is
// loaded by the browser. Sharing it would mean shimming browser globals into Node to save
// about forty lines. What is NOT duplicated is the record shape — the bot writes the same
// collections the app reads, and the schema lives in pb_migrations either way.

export class PbError extends Error {
  constructor(status, body) {
    super(body?.message || `PocketBase request failed (${status})`);
    this.name = 'PbError';
    this.status = status;
    this.data = body?.data || null;
  }
}

export function createClient(url) {
  let token = null;

  async function request(path, { method = 'GET', body } = {}) {
    const headers = {};
    let payload = body;

    if (body instanceof FormData) {
      payload = body; // let undici set the multipart boundary
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (token) headers.Authorization = token;

    const res = await fetch(`${url}${path}`, { method, headers, body: payload });
    const out = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new PbError(res.status, out);
    return out;
  }

  return {
    async signIn(identity, password) {
      const out = await request('/api/collections/users/auth-with-password', {
        method: 'POST',
        body: { identity, password },
      });
      token = out.token;
      return out.record;
    },

    /**
     * The parent a Telegram sender belongs to, or null.
     * Attribution is the whole point of per-parent accounts, so a memory sent from a
     * phone is credited to the person who sent it, never to the bot.
     */
    async findUserByTelegramId(telegramId) {
      const params = new URLSearchParams({
        perPage: '1',
        filter: `telegramId="${String(telegramId).replace(/["\\]/g, '')}"`,
      });
      const out = await request(`/api/collections/users/records?${params}`);
      return out.items[0] || null;
    },

    createPost({ memoryDate, caption, milestone, authorId }) {
      return request('/api/collections/posts/records', {
        method: 'POST',
        body: {
          memoryDate,
          caption: caption || '',
          isMilestone: Boolean(milestone),
          milestoneTitle: milestone?.title || '',
          author: authorId,
        },
      });
    },

    createPhoto({ postId, blob, filename, width, height, sort, video }) {
      const form = new FormData();
      form.append('post', postId);
      form.append('image', blob, filename);
      form.append('width', String(width));
      form.append('height', String(height));
      form.append('sort', String(sort));
      // No focal point: smart-crop measures pixels on a canvas, which needs a browser.
      // Absent means dead centre, which is what an unframed photo has always meant.
      if (video) {
        form.append('video', video.blob, video.filename);
        form.append('duration', String(video.duration || 0));
        form.append('trimStart', '0');
        // Capped exactly as the app caps it — nothing plays for longer than a minute.
        form.append('trimEnd', String(video.trimEnd || 0));
        form.append('isMotion', video.motion ? 'true' : 'false');
      }
      return request('/api/collections/photos/records', { method: 'POST', body: form });
    },
  };
}
