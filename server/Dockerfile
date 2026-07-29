# FlowGuard Node.js backend — Cloud Run image.
#
# - Listens on the Cloud Run-injected PORT (see config/serverConfig.js:
#   PORT -> APP_PORT -> 5001) and binds 0.0.0.0.
# - Production start is plain `node index.js` — nodemon is a devDependency
#   and is never installed here (npm ci --omit=dev).
# - No secrets are baked in: all configuration (DB_*, FACE_AI_URL,
#   AI_SERVICE_KEY, SMTP_*, ...) comes from Cloud Run environment variables
#   / Secret Manager at runtime. .env files are excluded by .dockerignore.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# bcrypt downloads a prebuilt glibc binary during install; no compiler needed.
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
# Documentation only — Cloud Run supplies PORT and routes to it.
EXPOSE 8080
CMD ["node", "index.js"]
