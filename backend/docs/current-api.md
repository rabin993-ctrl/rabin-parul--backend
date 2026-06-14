# Current API

The API is rooted at `/v1`. Protected routes require
`Authorization: Bearer <access-token>`. Mutable resources use optimistic
numeric versions where concurrent edits matter.

## Domains

- Authentication, refresh-session rotation, reactivation, and session control
- Owner/public profiles, usernames, avatars, privacy, blocks, reviews, saved
  posts, activity, deactivation, and deletion requests
- Companion profiles, care data, managers, transfers, relationships, follows,
  transactional 100-per-month treat wallets, idempotent gifts, treat privacy,
  adoption conversion, and companion feed views
- Presigned media upload, completion, status, signed reads, and deletion
- Feed posts, companion presentation, destinations, reactions, saves, comments
- Direct/adoption conversations, messages, attachments, editing, deletion,
  read state, typing, archive, preferences, and reports
- Durable notifications and per-domain notification preferences
- Communities, settings, rules, membership requests, invitations, roles, bans,
  ownership, moderated posts, comments, reports, saves, and search
- Paw Circle onboarding, discovery, membership, requests, invitations, bans,
  ownership transfer, chat, media, shared posts, pins, read state, and reports
- Adoption listings, applications, chat, placement records, milestones, home
  updates, recommendations, adopter responses, and relisting
- Rescue cases, followers, updates, status history, help offers, conversations,
  feed links, conversion, reports, and user summaries
- Lost-and-found alerts, private/public location precision, updates, sightings,
  ownership claims, matching, saves, conversations, reports, and resolution

## Health

- `GET /health/live`
- `GET /health/ready`

The authoritative route definitions live in `src/modules/*/routes.ts`. The
cross-domain integration smoke test in `scripts/smoke.mjs` exercises the
production API contract against PostgreSQL and MinIO, including privacy,
blocking, treat idempotency, notifications, reviews, and activity.
