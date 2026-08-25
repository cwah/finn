/// <reference path="../pb_data/types.d.ts" />

// Close the gallery, and give every drawing an owner.
//
// The gallery was built world-readable, on the assumption it would be sent to
// grandparents as a link. It is not going to be: it needs a password like the
// scrapbook, and the people who should see it get accounts, which is what the viewer
// accounts in 1755200000 already exist for. Both apps are now private and the
// asymmetry that shaped the original rules is gone.
//
// `author` arrives at the same time because deleting needs something to scope to. Same
// boundary the scrapbook draws in 1754700000: whoever added a thing can remove it, and
// nobody else can remove it out from under them.
//
// Creation is left as "any signed-in account with canPost", NOT pinned to the caller.
// That follows the scrapbook's reasoning — with an audience of a few people who trust
// each other, enforcing author = caller in a rule buys nothing, and a createRule that
// turns out to be subtly wrong takes the upload path down with it. The studio sets the
// author; the rule only decides who may write at all.
//
// ── THE BACKFILL ─────────────────────────────────────────────────────────────
// A relation added to an existing table is empty on every row, and an empty author
// against `author = @request.auth.id` matches nobody — so the drawing already hanging
// would become undeletable by anyone but a superuser. That is the same class of trap
// 1755200000 documented for bools and 1756200000 sidestepped for numbers.
//
// It is filled in only when the answer is unambiguous: exactly one account can post, so
// exactly one account can have added it. With more than one, guessing would attribute
// somebody's drawing to somebody else, which is worse than leaving it for a human — the
// migration says so in the logs and moves on.

migrate(
  (app) => {
    const AUTHED = '@request.auth.id != ""';
    const CAN_POST = '@request.auth.id != "" && @request.auth.canPost = true';
    const OWN = 'author = @request.auth.id';

    const users = app.findCollectionByNameOrId('users');
    const artworks = app.findCollectionByNameOrId('gallery_artworks');

    artworks.fields.add(new RelationField({
      name: 'author',
      collectionId: users.id,
      maxSelect: 1,
      // Losing an account must never delete the drawings it added.
      cascadeDelete: false,
    }));

    artworks.listRule = AUTHED;
    artworks.viewRule = AUTHED;
    artworks.createRule = CAN_POST;
    artworks.updateRule = OWN;
    artworks.deleteRule = OWN;
    app.save(artworks);

    const config = app.findCollectionByNameOrId('gallery_config');
    config.listRule = AUTHED;
    config.viewRule = AUTHED;
    app.save(config);

    // Attribute what is already hanging, but only when there is one possible answer.
    const posters = app.findRecordsByFilter('users', 'canPost = true', '', 50, 0);
    if (posters.length === 1) {
      app.db().newQuery(
        "UPDATE gallery_artworks SET author = {:id} WHERE author = '' OR author IS NULL",
      ).bind({ id: posters[0].id }).execute();
    } else {
      console.log(`gallery: ${posters.length} accounts can post, so existing drawings were `
        + 'left unattributed. Set gallery_artworks.author by hand, or they can only be '
        + 'deleted by a superuser.');
    }
  },

  (app) => {
    const PUBLIC = '';
    const CAN_POST = '@request.auth.id != "" && @request.auth.canPost = true';

    const artworks = app.findCollectionByNameOrId('gallery_artworks');
    artworks.listRule = PUBLIC;
    artworks.viewRule = PUBLIC;
    artworks.createRule = CAN_POST;
    artworks.updateRule = CAN_POST;
    artworks.deleteRule = CAN_POST;
    const author = artworks.fields.getByName('author');
    if (author) artworks.fields.removeById(author.id);
    app.save(artworks);

    const config = app.findCollectionByNameOrId('gallery_config');
    config.listRule = PUBLIC;
    config.viewRule = PUBLIC;
    app.save(config);
  },
);
