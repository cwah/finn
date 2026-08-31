/// <reference path="../../scrapbook/pb_data/types.d.ts" />

// Tell people when a new memory arrives.
//
// A cron inside PocketBase rather than anything else, because PocketBase is the only piece
// of this that is always running. The Telegram bot lives on a laptop; the frontend is a
// page nobody may have open. This runs wherever the scrapbook runs.
//
// THE RULE IS NOT HERE. It is in ./notify-rule.js, required by both this and the test
// suite, so what ships is what was tested. Everything below is plumbing: find, send, mark.
//
// DELIBERATELY QUIET ABOUT ITS OWN FAILURES, in one direction only. A send that fails is
// logged and retried on the next tick for up to a day, then given up on — SMTP has bad
// days, and mail arriving a week late would be worse than mail that never came. What it
// must never do is throw out of the cron handler, which in PocketBase's JSVM would take
// the scheduled job down with it.
//
// PREREQUISITE, and there is no way around it from code: SMTP has to be configured in
// Settings → Mail. Without it PocketBase falls back to a local `sendmail` binary, which
// does not exist in the container — so every send fails, is retried for a day, and stops.
// Nothing else breaks, but no mail arrives either.

/** How often to look. A minute is far finer than the five-minute settling delay needs. */
const EVERY_MINUTE = '* * * * *';

cronAdd('notify-new-posts', EVERY_MINUTE, () => {
  try {
    // REQUIRED INSIDE THE HANDLER, and passed down explicitly from here. PocketBase runs
    // handlers in a pooled runtime that does not necessarily share this file's top-level
    // scope — the docs say to require within the handler, and a binding that resolved at
    // load time and was undefined at run time would fail as silence, which is
    // indistinguishable from "nobody posted anything".
    const rule = require(`${__hooks}/notify-rule.js`);
    notifyPending(rule);
  } catch (err) {
    // A throw here would kill the scheduled job for the life of the process, with the same
    // symptom: silence.
    console.log('[notify] tick failed:', err);
  }
});

function notifyPending(rule) {
  const now = Date.now();
  const window = rule.createdWindow(now);

  // Settled, not stale, recent enough to be news, and not already sent. The same three
  // conditions shouldNotify checks per record — done here in SQL so a quiet minute costs
  // one indexed query rather than a scan.
  const posts = $app.findRecordsByFilter(
    'posts',
    'notifiedAt = "" && created <= {:until} && created >= {:since} && memoryDate >= {:recent}',
    'created',
    20, // a burst ceiling: a bulk import must not become a hundred emails in one tick
    0,
    { until: window.until, since: window.since, recent: rule.recentSince(now) },
  );
  if (!posts.length) return;

  const recipients = $app.findRecordsByFilter('users', 'notifyByEmail = true', '', 200, 0);

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

function deliver(rule, post, recipients, now) {
  // Re-checked against the values actually read. The filter and the rule are meant to
  // agree; if they ever drift, this is the side that decides, because it is the tested one.
  if (!rule.shouldNotify({
    created: post.getString('created'),
    memoryDate: post.getString('memoryDate'),
    notifiedAt: post.getString('notifiedAt'),
  }, now)) return;

  // Nobody is told about their own post. They were there.
  const authorId = post.getString('author');
  const audience = recipients.filter((u) => u.id !== authorId && u.email());

  let sent = 0;
  for (const person of audience) {
    try {
      $app.newMailClient().send(compose(post, person));
      sent += 1;
    } catch (err) {
      console.log('[notify] could not mail', person.email(), err);
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

/** The message itself. Plain and short: it is a nudge, not a newsletter. */
function compose(post, person) {
  const settings = $app.settings();
  const site = settings.meta.appURL || '';
  const caption = post.getString('caption');
  const milestone = post.getBool('isMilestone') ? post.getString('milestoneTitle') : '';

  const headline = milestone || 'A new memory';
  // The caption is a parent's own words and may contain anything, so it is escaped before
  // it goes anywhere near an HTML body.
  const body = caption ? `<p>${escapeHtml(caption)}</p>` : '';

  return new MailerMessage({
    from: { address: settings.meta.senderAddress, name: settings.meta.senderName },
    to: [{ address: person.email() }],
    subject: `${headline} in Finnbook`,
    html: `
      <p>${escapeHtml(headline)} was added to Finnbook.</p>
      ${body}
      <p><a href="${escapeHtml(site)}">Open Finnbook</a></p>
      <p style="color:#5c6a60;font-size:12px">
        You are getting this because email updates are switched on for your account.
        Turn them off at the top of the scrapbook.
      </p>`,
    text: `${headline} was added to Finnbook.\n\n${caption || ''}\n\n${site}\n\n`
      + 'You are getting this because email updates are switched on for your account. '
      + 'Turn them off at the top of the scrapbook.',
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
