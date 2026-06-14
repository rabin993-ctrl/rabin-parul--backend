# Parul Backend

Backend foundation for the Parul Expo application.

## Stack

- Node.js 24 LTS and TypeScript
- Fastify 5
- PostgreSQL 18
- Drizzle ORM and SQL migrations
- Stateless JWT access tokens with rotating, server-revocable refresh sessions
- Docker Compose for VPS deployment

The backend implements authentication, profiles, companions, media, feed,
messaging, notifications, communities, Paw Circles, adoption, rescue, and
lost-and-found workflows. Shared audit, outbox, media, idempotency, optimistic
versioning, and privacy controls support the domain modules.

## Local development

```bash
cp .env.example .env
docker compose up -d postgres minio minio-init
npm install
npm run db:migrate
npm run dev
```

The API listens on `http://localhost:8080`. Use `GET /health/live` and
`GET /health/ready` for container health checks.

After both containers are healthy, exercise the implemented API:

```bash
npm run test:smoke
```

Release verification also runs `npm run typecheck`, `npm test`, `npm run
build`, and `npm audit --omit=dev`.

See `docs/current-api.md` for the current route list and
`docs/architecture.md` for module sequencing.

## Production

Set `ACCESS_TOKEN_SECRET` to at least 32 random characters and use a strong
`POSTGRES_PASSWORD`, then run:

```bash
docker compose up -d --build
```

For the complete frontend/API/TLS stack, use the root
`compose.production.yaml` and deployment instructions in the repository root
README. PostgreSQL and MinIO are private in that topology.
