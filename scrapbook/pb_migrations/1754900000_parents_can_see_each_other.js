/// <reference path="../pb_data/types.d.ts" />

// Let a signed-in parent read the other parent's user record.
//
// PocketBase ships the users collection locked to `id = @request.auth.id`, which is the
// right default for an app with strangers in it. Here it silently broke attribution:
// `expand=author` on someone else's post returned nothing, so every memory written by
// the other parent rendered with no name against it — the one thing per-parent accounts
// exist to provide.
//
// Read-only, and only for signed-in users. Passwords and tokens are system-hidden by
// PocketBase regardless, and email stays private unless a record opts in via
// emailVisibility. Nothing here lets one parent modify the other's account.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.listRule = '@request.auth.id != ""';
    users.viewRule = '@request.auth.id != ""';
    app.save(users);
  },

  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    app.save(users);
  },
);
