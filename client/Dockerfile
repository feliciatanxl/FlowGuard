# FlowGuard React frontend — Cloud Run image (static build served by Nginx).
#
# Architecture: same-origin reverse proxy. The production bundle is built with
# VITE_API_BASE_URL left EMPTY, so every API call stays a relative URL
# (/api, /user) and Nginx forwards it to the Node Cloud Run service at runtime
# (see nginx.conf). Benefits:
#   - no backend URL or secret is baked into the image or JS bundle;
#   - no CORS exposure (browser only sees one origin);
#   - the browser never talks to the (private) AI service — all AI traffic,
#     including /api/yolo/*, goes through the Node backend.
#
# Do NOT pass secrets as build args — every VITE_ value ships to the browser.
# The only build-time value a deployment may optionally supply is the PUBLIC
# reCAPTCHA site key.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public (browser-visible) value only. Never pass secrets here.
ARG VITE_RECAPTCHA_SITE_KEY=""
ENV VITE_RECAPTCHA_SITE_KEY=${VITE_RECAPTCHA_SITE_KEY}
RUN npm run build

FROM nginx:1.27-alpine
# The nginx entrypoint runs envsubst on *.template files at startup, injecting
# PORT (from Cloud Run) plus BACKEND_HOST / AI_HOST (service env vars).
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# Default for local `docker run`; Cloud Run always overrides PORT itself.
ENV PORT=8080
EXPOSE 8080
