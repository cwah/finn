// Signing a Web Push request from inside PocketBase.
//
// Web Push (RFC 8291) authenticates with VAPID (RFC 8292): an ES256 JWT in an
// `Authorization` header, signed with a P-256 private key. PocketBase's JSVM has no
// asymmetric crypto — `$security.createJWT` is HS256 only — so the signature itself is
// done by `openssl` through `$os.cmd`, which is why the Dockerfile installs it.
//
// NO PAYLOAD IS SENT, deliberately. A push message with a body has to be encrypted with
// ECDH + HKDF + AES128GCM per RFC 8291, which is a great deal of hand-rolled crypto to get
// subtly wrong. A push with no body needs only the VAPID header — the service worker shows
// "a new memory" and the app fetches the detail when it is opened. Less to break, and
// nothing private crosses a third-party push service either.
//
// PURE, and CommonJS, so the byte-level part can be tested from node against node's own
// crypto — which is exactly how the DER conversion below was checked.

// The URL alphabet, used directly rather than swapped in afterwards.
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * base64url: the URL alphabet, no padding, as JOSE requires.
 *
 * WRITTEN OUT BY HAND, and that is the point. This used `btoa`, above a comment of mine
 * asserting that "btoa exists in the JSVM". It does not. PocketBase's engine is Goja,
 * which implements ECMAScript and not the browser's web APIs — there is no btoa, no atob,
 * no TextEncoder, no fetch. Every push therefore died on `btoa is not defined`, inside a
 * cron, where the only trace was a container log nobody was reading.
 *
 * The tests did not catch it because they run in node, where btoa is perfectly real. A
 * pure module tested in the wrong environment is not tested. See vapid-jsvm.test.js, which
 * runs this file with those globals taken away.
 */
function base64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;

    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)];
    if (b1 < 0) break;                       // one byte left: two characters, no padding
    out += B64URL[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)];
    if (b2 < 0) break;                       // two bytes left: three characters
    out += B64URL[b2 & 63];
  }
  return out;
}

/**
 * UTF-8 bytes of a string, without TextEncoder.
 *
 * The previous version went through `unescape(encodeURIComponent(...))`, which works but
 * leans on `unescape` — an Annex B leftover that an engine is not obliged to have. Since
 * the whole lesson here is not to assume what the JSVM provides, this uses nothing beyond
 * charCodeAt.
 */
function utf8Bytes(text) {
  const s = String(text);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // A surrogate pair is ONE code point; encoding each half separately produces the
      // mojibake that makes an emoji in a subject line into three broken characters.
      const cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      i += 1;
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return new Uint8Array(out);
}

/** The same, for text. */
function base64urlText(text) {
  return base64url(utf8Bytes(text));
}

/**
 * openssl's DER signature -> the raw R||S that JOSE wants.
 *
 * `openssl dgst -sign` emits ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }. JOSE wants the
 * two numbers concatenated, each padded to exactly 32 bytes for P-256. The conversion is
 * not optional and not cosmetic — a DER blob in the signature slot is simply rejected, and
 * the failure arrives as a 401 from a push service with nothing explaining it.
 *
 * Two traps, both of which produce a signature that is wrong only SOMETIMES:
 *
 *   a leading 0x00  DER integers are signed, so a value whose top bit is set gets a zero
 *                   byte in front. Copied through, R becomes 33 bytes and everything after
 *                   it shifts. Happens for about half of all signatures.
 *   a SHORT integer a value with leading zero bits is encoded in fewer bytes. Left
 *                   unpadded, R is 31 bytes and S starts one byte early. Rarer, so it
 *                   would pass a handful of tests and fail in the wild.
 *
 * @param {Uint8Array} der
 * @returns {Uint8Array} 64 bytes
 */
function derToJose(der) {
  if (!der || der.length < 8 || der[0] !== 0x30) {
    throw new Error('not a DER ECDSA signature');
  }
  // SEQUENCE length may be short-form (one byte) or long-form (0x81 + one byte). P-256
  // signatures never exceed 127 bytes of content, so those two are the only shapes.
  let at = der[1] & 0x80 ? 3 : 2;

  const readInt = () => {
    if (der[at] !== 0x02) throw new Error('expected an ASN.1 INTEGER');
    const len = der[at + 1];
    let start = at + 2;
    let end = start + len;
    // Drop the sign byte DER adds when the top bit is set.
    while (end - start > 32 && der[start] === 0x00) start += 1;
    if (end - start > 32) throw new Error('integer too long for P-256');
    const out = new Uint8Array(32);
    // Right-aligned, so a short integer is LEFT-padded with zeros rather than shifting
    // everything after it.
    out.set(der.subarray(start, end), 32 - (end - start));
    at = end;
    return out;
  };

  const r = readInt();
  const s = readInt();
  const jose = new Uint8Array(64);
  jose.set(r, 0);
  jose.set(s, 32);
  return jose;
}

/**
 * The `aud` claim: the ORIGIN of the push endpoint, and nothing more of it.
 *
 * Push services reject a token whose audience carries the path — and the path is the
 * subscription's secret, so sending it in a claim would be leaking it besides.
 */
function audienceFor(endpoint) {
  const match = /^(https?:\/\/[^/]+)/i.exec(String(endpoint || ''));
  if (!match) throw new Error(`not a push endpoint: ${endpoint}`);
  return match[1];
}

/**
 * The signing input for a VAPID token: "header.payload", base64url each.
 *
 * @param {string} audience origin of the push service
 * @param {string} subject a mailto: or https: identifying the sender, per RFC 8292
 * @param {number} expSeconds absolute expiry, unix seconds
 */
function signingInput(audience, subject, expSeconds) {
  const header = base64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64urlText(JSON.stringify({
    aud: audience,
    // Capped by the spec at 24 hours from now; push services reject anything longer.
    exp: Math.floor(expSeconds),
    sub: subject,
  }));
  return `${header}.${payload}`;
}

module.exports = { base64url, base64urlText, derToJose, audienceFor, signingInput };
