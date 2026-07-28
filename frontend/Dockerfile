# syntax=docker/dockerfile:1
#
# Facet frontend. Multi-stage: the runtime image carries only the standalone
# server bundle, not node_modules or the source tree.

FROM node:24-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# `npm ci` needs the lockfile to match package.json exactly — that is the
# point of using it here rather than `npm install`.
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./

# Next resolves rewrites at BUILD time into .next/routes-manifest.json — a
# runtime env var does not reach them. So BACKEND_ORIGIN must be set here, or
# the image ships with no proxy at all and every /api/* call 404s.
#
# The default is the compose service name, which is identical on every
# machine, so this stays portable: it is an address on the container network,
# not on anyone's host. Override for a different topology:
#   docker build --build-arg BACKEND_ORIGIN=http://api:9000 ...
ARG BACKEND_ORIGIN=http://backend:8000
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}

# Empty API base: the browser calls the frontend's own origin, so no host or
# port is baked into the JS bundle and nothing is cross-origin.
ENV NEXT_PUBLIC_API_BASE="" \
    NEXT_OUTPUT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 10001 -S facet && adduser -u 10001 -S facet -G facet

# `standalone` already contains a minimal node_modules; static/ and public/
# are not included in it and must be copied alongside.
COPY --from=builder --chown=facet:facet /app/.next/standalone ./
COPY --from=builder --chown=facet:facet /app/.next/static ./.next/static
COPY --from=builder --chown=facet:facet /app/public ./public

USER facet
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
