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
# Every VITE_ build argument below is browser-visible. Pi values are optional
# public device URLs, never credentials or authentication secrets. Runtime
# browser configuration remains preferred because hotspot addresses can change.

# @zxing/library 0.23 declares Node >=24 for its build toolchain. Match the
# supported engine used by local CI so the container build has no EBADENGINE gap.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public (browser-visible) value only. Never pass secrets here.
ARG VITE_RECAPTCHA_SITE_KEY="6LdlueksAAAAAKcaIPqJG3IpQVavifKxCMkYk0P9"
ENV VITE_RECAPTCHA_SITE_KEY=${VITE_RECAPTCHA_SITE_KEY}
ARG VITE_ENABLE_PI_CAMERA=""
ARG VITE_PI_CAMERA_HEALTH_URL=""
ARG VITE_PI_CAMERA_STREAM_URL=""
ARG VITE_PI_CAMERA_SNAPSHOT_URL=""
ENV VITE_ENABLE_PI_CAMERA=${VITE_ENABLE_PI_CAMERA}
ENV VITE_PI_CAMERA_HEALTH_URL=${VITE_PI_CAMERA_HEALTH_URL}
ENV VITE_PI_CAMERA_STREAM_URL=${VITE_PI_CAMERA_STREAM_URL}
ENV VITE_PI_CAMERA_SNAPSHOT_URL=${VITE_PI_CAMERA_SNAPSHOT_URL}
RUN npm run build

FROM nginx:1.27-alpine
# The nginx entrypoint runs envsubst on *.template files at startup, injecting
# PORT (from Cloud Run) plus BACKEND_HOST / AI_HOST (service env vars).
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# Default for local `docker run`; Cloud Run always overrides PORT itself.
ENV PORT=8080
EXPOSE 8080
