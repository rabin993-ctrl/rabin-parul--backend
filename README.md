# Parul

Parul is an Expo/React Native frontend with a Fastify/PostgreSQL backend. The
repository includes a production Docker stack for a single VPS.

## Production deployment

1. Point `APP_DOMAIN` and `MEDIA_DOMAIN` DNS records at the VPS.
2. Allow inbound TCP ports `80` and `443`, plus UDP `443`.
3. Create the production environment:

```bash
cp .env.production.example .env
```

4. Replace every placeholder secret, then start the stack:

```bash
docker compose --env-file .env -f compose.production.yaml config --quiet
docker compose --env-file .env -f compose.production.yaml up -d --build
```

Caddy obtains and renews TLS certificates automatically. PostgreSQL and MinIO
are not published to the host. The API runs migrations before starting, and
the frontend is built with `https://$APP_DOMAIN/v1` as its API endpoint.

Check deployment health:

```bash
docker compose --env-file .env -f compose.production.yaml ps
curl -fsS "https://$APP_DOMAIN/health/ready"
```

Back up both `parul_postgres` and `parul_media` volumes before upgrades. To
deploy a new revision, pull or copy the updated repository and rerun the same
`docker compose ... up -d --build` command.

Native Expo builds should set `EXPO_PUBLIC_API_URL=https://$APP_DOMAIN/v1` in
their build environment. The Docker web image receives the same endpoint
automatically from `compose.production.yaml`.

## Local development

Backend:

```bash
cd backend
cp .env.example .env
docker compose up -d postgres minio minio-init
npm install
npm run db:migrate
npm run dev
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm run web
```
