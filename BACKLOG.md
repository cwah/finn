# Backlog

Feature requests and ideas for the scrapbook. Anything here is a **candidate, not a
commitment** — the build phases in `CLAUDE.md` are the actual plan, and this is the pile
of things we might pull into one.

Add an item as `- [ ] What it is — why, and anything that constrains it`. Move it under
Shipped when it lands. No ceremony beyond that.

## Ideas

- [ ] **Real milestone art.** Replace the placeholder SVG sketches with PNG files, one
      per preset (balloons, cake, blocks, donuts, dinosaur, lemons). The preset name is
      already the contract — see the milestone sketch section in `CLAUDE.md` for the
      one-line swap point.
- [ ] **Telegram bot access.** Allow users to upload and add new posts via Telegram bot.
- [ ] **Parallax fade in//out of milestone art.**
- [ ] **Suggested weekly prompts.** Generate suggestions and message user on a weekly basis to add to scrapbook; can be pregenerated with LLM
- [ ] **Support video upload.**
- [ ] **Support photo carousels.** If more than 4 images are uploaded, show them in a carousel instead of a grid.
- [ ] **Image handling.** Support smart cropping or manual cropping of thumbnail images. Consider allowing the user to select which image is the main image for the post. Expand image to full aspect ratio when clicked on.

## Shipped

- [x] Phase 2 — PocketBase: schema in `pb_migrations/`, one account per parent, photo
      upload to local disk, and a data layer that still swaps back to mock with one line.
- [x] Single entrypoint — one floating `+` opens the compose sheet; photos are attached
      from inside it. Replaced the two-button tray, and the bottom bar is gone with it.
- [x] Compose sheet — caption, memory date, and an optional milestone on capture.
- [x] Milestone sketches beside the card, alternating sides, fading on scroll.
- [x] Right-edge date scrubber, Google Photos style.
- [x] Light pastel sage-and-blue palette.
