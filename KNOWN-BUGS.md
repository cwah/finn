# Known bugs

Things that are broken or behave surprisingly, and what is known about why. Distinct from
`BACKLOG.md`, which is things not built yet — everything here is something that *looks*
built and does not work.

Add an entry as `## Short title`, then: what happens, what is known, and what is not.
Move it out when it is fixed, and say so in the commit.

---

*Nothing currently known to be broken.*

Fixed and moved out:

- Live/motion photos from Telegram arrived as plain stills — `Message.live_photo` was
  never read, because Telegram also sets `Message.photo` for backward compatibility and
  the parser checked that first. Fixed by checking `live_photo` first.
