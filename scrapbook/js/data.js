// The switchboard. Everything above this line speaks the JSON contract in CLAUDE.md and
// nothing else, so swapping the backend is swapping this one constant.
//
//   'pocketbase' — Phase 2 onwards. Needs ./pocketbase serve running (see README).
//   'mock'       — Phase 1. Static data/mock.json, no backend, no accounts.
//
// Both modules export the same five functions; keep them in step when either changes.

import * as mock from './data-mock.js';
import * as pocketbase from './data-pb.js';

export const SOURCE = 'pocketbase';

const impl = SOURCE === 'mock' ? mock : pocketbase;

export const {
  requireSession, signIn, signOut, getConfig, getPosts, createPost, updatePost, deletePost,
  setEmailNotifications,
} = impl;

/** True when the backend has real accounts, so the UI knows to offer signing in/out. */
export const HAS_ACCOUNTS = SOURCE !== 'mock';
