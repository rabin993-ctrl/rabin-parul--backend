# Backend Architecture

## Decision

Parul starts as a modular monolith backed by PostgreSQL. The product workflows
regularly require atomic changes across related records, including adoption
confirmation, companion creation, rescue status changes, membership approval,
message creation, audit history, and event publication. Keeping those modules
in one deployable service and one transactional database is the simplest
reliable VPS architecture.

Modules remain separated by route, service, table ownership, and domain events
so high-volume areas can be extracted later without rewriting public APIs.

## Runtime components

- `api`: Fastify HTTP service
- `postgres`: canonical relational data, transactions, search indexes, outbox
- future `worker`: outbox delivery, media processing, notifications, schedules
- future Redis: ephemeral presence, distributed rate limits, realtime fanout
- future S3-compatible storage: original media and generated renditions

Redis is deliberately not a canonical store. The first deployment can run
without it; PostgreSQL remains authoritative for sessions, unread state,
idempotency, and durable jobs.

## Module order

1. Platform: configuration, errors, auth, sessions, audit, outbox, idempotency
2. Profiles and privacy
3. Companions
4. Media uploads
5. Feed, comments, reactions, saves, and placements
6. Direct and domain-linked messaging
7. Communities and Paw Circles
8. Adoption and rescue
9. Lost and found
10. Notifications, realtime delivery, moderation, and scheduled workers

## API rules

- All public routes live under `/v1`.
- IDs and timestamps are server-generated.
- Mutating retry-sensitive routes accept `Idempotency-Key`.
- Mutable aggregate updates use a numeric version or `If-Match`.
- Errors use stable machine-readable codes.
- Viewer-specific read models contain capability flags.
- Private care, contact, location, and moderation data never share public DTOs.
- Domain state and outbox events commit in the same transaction.
