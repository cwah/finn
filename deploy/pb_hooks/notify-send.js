// Sending the notifications. Required BY notify.pb.js, never loaded as a hook itself.
//
// WHY THIS IS A SEPARATE FILE. PocketBase runs a hook handler in a POOLED RUNTIME that does
// not share the defining file's top-level scope — the docs say to `require()` inside the
// handler, and the reason is that nothing else from the file is reachable either. A cron
// handler calling a top-level `notifyPending()` therefore throws "notifyPending is not
// defined", which is exactly what happened. Only globals ($app, $os, $http, DateTime) and
// what the handler requires for itself survive the boundary.
//
// So everything lives here, behind one `run()`, and notify.pb.js is a one-liner. Which also
// means this file can be required from a test.
//
// PREREQUISITES, none of which code can supply:
//
//   VAPID_PRIVATE_KEY   a P-256 private key in PEM, as a Render environment variable.
//   VAPID_PUBLIC_KEY    the matching public key, base64url, uncompressed point.
//   VAPID_SUBJECT       a mailto: or https: URL identifying the sender, per RFC 8292.
//
// Without them the tick logs and does nothing. Nothing else breaks.
//
// NO PAYLOAD IS SENT. A push with a body must be encrypted per RFC 8291 — ECDH, HKDF and
// AES128GCM — which is a great deal of hand-rolled crypto to get subtly wrong, and it would
// put a parent's caption through a third-party push service besides. A bodiless push needs
// only the VAPID header; the service worker says "a new memory" and the app fetches the
// detail when it is opened.

function run() {
  const rule = require(`${__hooks}/notify-rule.js`);
  const now = Date.now();
  const window = rule.createdWindow(now);

  // Settled, not stale, recent enough to be news, and not already sent. The same three
  // conditions shouldNotify checks per record — done here in SQL so a quiet minute costs
  // one indexed query rather than a scan.
  const posts = $app.findRecordsByFilter(
    'posts',
    'notifiedAt = "" && created <= {:until} && created >= {:since} && memoryDate >= {:recent}',
    'created',
    20, // a burst ceiling: a bulk import must not become a hundred buzzes in one tick
    0,
    { until: window.until, since: window.since, recent: rule.recentSince(now) },
  );
  if (!posts.length) return;

  const recipients = $app.findRecordsByFilter('pushSubscriptions', 'id != ""', 'id', 200, 0);
  // One line per non-empty tick. Without it, "no notification arrived", "no post
  // qualified" and "nobody has subscribed" are the same observation from outside.
  console.log('[notify]', posts.length, 'post(s) due,', recipients.length, 'subscription(s)');

  for (const post of posts) {
    try {
      deliver(rule, post, recipients, now);
    } catch (err) {
      // One post's failure must not cost the others theirs. Left unmarked, so the next
      // tick tries again until the give-up window closes.
      console.log('[notify] post', post.id, 'failed:', err);
    }
  }
}

/**
 * A record field as a plain string, whatever shape the JSVM hands back.
 *
 * `created` is a SYSTEM field and a date besides, so it does not necessarily come back
 * from `getString` the way an ordinary text field does — it can arrive as a DateTime
 * wrapper. The first version read it with `getString` and got an empty string, which
 * `shouldNotify` then failed to parse, so every post was silently judged unnotifiable:
 * nothing sent, nothing marked, and no error anywhere. Exactly the shape of a bug that
 * looks like "the feature does nothing".
 *
 * Both shapes are handled rather than one guessed at, because the cost of guessing wrong
 * here is silence.
 */
function asText(record, field) {
  const raw = record.get(field);
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw.string === 'function') return raw.string();
  return String(raw);
}

function deliver(rule, post, recipients, now) {
  // Re-checked against the values actually read. The filter and the rule are meant to
  // agree; if they ever drift, this is the side that decides, because it is the tested one.
  const seen = {
    created: asText(post, 'created'),
    memoryDate: asText(post, 'memoryDate'),
    notifiedAt: asText(post, 'notifiedAt'),
  };
  if (!rule.shouldNotify(seen, now)) {
    // Loud on purpose. The filter selected this post, so the two disagreeing is a bug
    // rather than a quiet no — and the values are what would identify it.
    console.log('[notify] filter and rule disagree on', post.id, JSON.stringify(seen));
    return;
  }

  // Nobody is told about their own post. They were there.
  const authorId = asText(post, 'author');
  const audience = recipients.filter((sub) => asText(sub, 'user') !== authorId);

  let sent = 0;
  for (const sub of audience) {
    const endpoint = asText(sub, 'endpoint');
    try {
      pushTo(endpoint);
      sent += 1;
    } catch (err) {
      const gone = String(err).includes('410') || String(err).includes('404');
      if (gone) {
        // The browser has thrown this subscription away — an uninstalled app, cleared site
        // data, a device that is gone. Keeping it means retrying a dead endpoint every
        // minute forever, so it goes.
        try { $app.delete(sub); console.log('[notify] dropped a dead subscription'); }
        catch (e) { console.log('[notify] could not drop a dead subscription:', e); }
      } else {
        console.log('[notify] push failed:', err);
      }
    }
  }

  // Marked when something got through, and ALSO when there was nobody to tell — otherwise
  // a post with no opted-in audience would be re-examined every minute until it aged out.
  // Not marked when there were recipients and every one failed: that is the case worth
  // retrying.
  if (sent > 0 || audience.length === 0) {
    post.set('notifiedAt', new DateTime());
    $app.save(post);
    if (sent > 0) console.log('[notify] post', post.id, '->', sent, 'recipient(s)');
  }
}

/**
 * Wake one device.
 *
 * A bodiless Web Push: a POST to the subscription's endpoint carrying only the VAPID
 * authorisation and a TTL. There is nothing to encrypt because there is nothing to send —
 * the service worker knows what to say.
 *
 * Throws on anything that is not a 2xx, so the caller can tell a dead subscription (404 or
 * 410, drop it) from a bad day (anything else, try again next tick).
 */
function pushTo(endpoint) {
  const vapid = require(`${__hooks}/vapid.js`);
  const priv = $os.getenv('VAPID_PRIVATE_KEY');
  const pub = $os.getenv('VAPID_PUBLIC_KEY');
  const subject = $os.getenv('VAPID_SUBJECT') || 'mailto:nobody@example.com';
  if (!priv || !pub) throw new Error('VAPID keys are not configured');

  // Twelve hours. The spec caps a VAPID token at 24; well inside it, and re-signed every
  // send anyway, so there is no reason to sail close.
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const input = vapid.signingInput(vapid.audienceFor(endpoint), subject, exp);
  const signature = signES256(input, priv);

  const res = $http.send({
    url: endpoint,
    method: 'POST',
    headers: {
      // `vapid` scheme: the token, then the public key that verifies it.
      Authorization: `vapid t=${input}.${signature}, k=${pub}`,
      TTL: '86400',            // hold it for a day if the device is offline
      'Content-Length': '0',   // explicit, because there is deliberately no body
    },
    timeout: 30,
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`push ${res.statusCode}: ${String(res.body || '').slice(0, 200)}`);
  }
}

/**
 * ES256, by way of openssl.
 *
 * The JSVM cannot do asymmetric crypto, so the signing is shelled out. Files rather than
 * stdin because `$os.cmd(...).output()` gives no way to write to a process — and the key
 * has to reach openssl somehow, since it will not take one on a command line either.
 *
 * The key file is removed in a finally. It is a private key sitting on a container
 * filesystem for the length of one signature, which is brief but not nothing.
 */
function signES256(input, privatePem) {
  const vapid = require(`${__hooks}/vapid.js`);
  const dir = $os.tempDir();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const keyPath = `${dir}/vapid-${stamp}.pem`;
  const dataPath = `${dir}/vapid-${stamp}.txt`;
  const sigPath = `${dir}/vapid-${stamp}.der`;

  try {
    $os.writeFile(keyPath, privatePem, 0o600);
    $os.writeFile(dataPath, input, 0o600);
    // Writes DER to sigPath; anything on stdout here is an error worth surfacing.
    const noise = toString($os.cmd('openssl', 'dgst', '-sha256',
      '-sign', keyPath, '-out', sigPath, dataPath).output());
    if (noise && noise.trim()) console.log('[notify] openssl said:', noise.trim());

    // DER -> JOSE, and this conversion is NOT optional. openssl emits ASN.1
    // (SEQUENCE { INTEGER r, INTEGER s }); JOSE wants the two numbers concatenated at 32
    // bytes each. Base64url-ing the DER straight through — which is what this line did
    // first — produces a token every push service rejects with a bare 401.
    const der = $os.readFile(sigPath);
    return vapid.base64url(vapid.derToJose(new Uint8Array(der)));
  } finally {
    for (const path of [keyPath, dataPath, sigPath]) {
      try { $os.remove(path); } catch { /* already gone */ }
    }
  }
}

module.exports = { run };
