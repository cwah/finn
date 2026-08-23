/// <reference path="../pb_data/types.d.ts" />

// Scrapbook schema. PocketBase applies this automatically on startup, so the collections
// are version-controlled rather than clicked together in the admin UI.
//
// Mirrors the JSON contract in CLAUDE.md:
//
//   config  — one record: babyName, birthDate
//   posts   — memoryDate, caption, isMilestone, milestoneTitle, author -> users
//   photos  — post -> posts, image (file), width, height, alt, sort
//
// Photos are their own collection rather than a multi-file field on posts because the
// contract needs width/height PER PHOTO: the layout engine picks a layout from stored
// dimensions and must never load an image to decide. A PocketBase file field carries no
// dimensions, so they need a real home. It also gives Phase 3's optimised variants
// somewhere natural to hang.

migrate(
  (app) => {
    const AUTHED = '@request.auth.id != ""';

    // ── config ────────────────────────────────────────────────────
    // Readable by either parent, writable only by a superuser: birthDate is the anchor
    // every age stamp is computed from, so it should not be editable from the app.
    const config = new Collection({
      type: 'base',
      name: 'config',
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'babyName', required: true, max: 80 },
        { type: 'date', name: 'birthDate', required: true },
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
    });
    app.save(config);

    // ── posts ─────────────────────────────────────────────────────
    const users = app.findCollectionByNameOrId('users');

    const posts = new Collection({
      type: 'base',
      name: 'posts',
      listRule: AUTHED,
      viewRule: AUTHED,
      // Either parent may write, and the client stamps `author`. With an audience of two
      // who trust each other, pinning author to the caller server-side buys nothing and
      // costs a rule that has to be kept in step with PocketBase's rule syntax.
      createRule: AUTHED,
      updateRule: AUTHED,
      deleteRule: AUTHED,
      fields: [
        { type: 'date', name: 'memoryDate', required: true },
        { type: 'text', name: 'caption', max: 2000 },
        { type: 'bool', name: 'isMilestone' },
        { type: 'text', name: 'milestoneTitle', max: 80 },
        {
          type: 'relation',
          name: 'author',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false, // losing an account must never delete the memories
        },
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      // The timeline is always ordered by memoryDate, newest first.
      indexes: ['CREATE INDEX `idx_posts_memoryDate` ON `posts` (`memoryDate` DESC)'],
    });
    app.save(posts);

    // ── photos ────────────────────────────────────────────────────
    const photos = new Collection({
      type: 'base',
      name: 'photos',
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: AUTHED,
      updateRule: AUTHED,
      deleteRule: AUTHED,
      fields: [
        {
          type: 'relation',
          name: 'post',
          required: true,
          collectionId: posts.id,
          maxSelect: 1,
          cascadeDelete: true, // deleting a post should take its photos with it
        },
        {
          type: 'file',
          name: 'image',
          required: true,
          maxSelect: 1,
          maxSize: 15728640, // 15 MB — phone photos, before Phase 3 compression
          mimeTypes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'image/heic',
            'image/heif',
          ],
        },
        // Intrinsic dimensions, measured client-side at capture. The layout engine reads
        // these and never loads an image to decide a layout.
        { type: 'number', name: 'width', required: true, onlyInt: true },
        { type: 'number', name: 'height', required: true, onlyInt: true },
        { type: 'text', name: 'alt', max: 300 },
        { type: 'number', name: 'sort', onlyInt: true },
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX `idx_photos_post` ON `photos` (`post`, `sort`)'],
    });
    app.save(photos);
  },

  (app) => {
    // Reverse order: photos and posts hold relations to what comes after them.
    for (const name of ['photos', 'posts', 'config']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // already gone
      }
    }
  },
);
