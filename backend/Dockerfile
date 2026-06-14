FROM node:24.16.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build
RUN npm prune --omit=dev

FROM node:24.16.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S parul && adduser -S parul -G parul
COPY --from=build --chown=parul:parul /app/node_modules ./node_modules
COPY --from=build --chown=parul:parul /app/dist ./dist
COPY --from=build --chown=parul:parul /app/drizzle ./drizzle
COPY --from=build --chown=parul:parul /app/package.json ./
USER parul
EXPOSE 8080
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
