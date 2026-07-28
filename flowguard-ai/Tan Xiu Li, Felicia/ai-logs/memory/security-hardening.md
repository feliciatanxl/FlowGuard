---
name: security-hardening
description: "CodeQL/Dependabot fixes on branch fix/security-codeql-dependabot — rate-limit design, CORS fail-closed, dep overrides, and two documented false positives"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7632c623-18dc-49b8-8f49-24ca928ffc82
  modified: 2026-07-28T07:50:32.169Z
---

Security hardening done 2026-07-28 on branch `fix/security-codeql-dependabot` (local only — NOT pushed/merged/closed). Relates to [[flowguard-felicia-scope]], [[camera-qr-architecture]], [[gate-verification-feature]].

**Rate limiting (CodeQL js/missing-rate-limiting):** `server/middlewares/rateLimit.js` refactored onto `express-rate-limit@7.5.0` (CJS build; v8 is ESM-first — do NOT bump blindly). Factory `makeLimiter` + named policies: `authLimiter`(30/15min IP), `passwordResetLimiter`(5/15min IP — preserves the forgot-password test), `publicLookupLimiter`, `readLimiter`(300/min), `writeLimiter`(120/min), `uploadLimiter`(40/min), `aiProxyLimiter`(1200/min). `createRateLimiter({windowMs,max,keyFn})` kept for back-compat. **Key (revised in review): `keyByUserOrIp` uses ONLY verified `req.user.id` when a limiter runs after verifyToken, else client IP — NO `jwt.decode` (an unverified/forged token must never pick/rotate a key).** Applied as `router.use(...)` at the top of every route file (readLimiter for most; aiProxyLimiter for facialRecognition/qr/yolo/edgeDetectionAlerts) — these are pre-auth so key by IP. `skipInternalService` exempts `x-service-key` AI calls. `index.js` sets `app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))` — **`parseTrustProxy` in config/serverConfig.js** converts numeric strings to Number, passes named/subnet presets through as strings, "true"/"false"→bool, undefined→1 (never NaN). All limits env-tunable (`RATE_LIMIT_*`). Peak that MUST pass: GateScanner 250ms track (240/min) + 1s recognize (60/min) ≈ 300/min/user. **MemoryStore is per-process/per-Cloud-Run-instance = STAGING-ONLY, not distributed** (documented in rateLimit.js + deployment.md; use rate-limit-redis for global).

**CORS (CodeQL permissive-cors):** `corsOptions.js` — `buildAllowedOrigins` stays PURE (its tests unchanged); `buildCorsOptions` now FAILS CLOSED in prod/staging (NODE_ENV) when no origin configured (denies browser origins, allows no-Origin), and uses a localhost allowlist in dev — never `origin:'*'`. Only the one wildcard assertion in cors.test.js changed.

**Reset-token SHA-256 (CodeQL js/insufficient-password-hash) = FALSE POSITIVE:** high-entropy `crypto.randomBytes(32)` token, SHA-256 digest is for O(1) DB lookup, not password hashing (accounts use bcrypt). Isolated into `server/utils/resetTokenDigest.js` (`generateResetToken`/`digestResetToken`) with an inline `codeql[js/insufficient-password-hash]` suppression + rationale; test uses the helper.

**XSS (CodeQL DOM-text-as-HTML) FacialEvaluation.jsx + ObjectDetection.jsx:** object-URL previews. Added `client/src/utils/mediaPreview.js` (`validateImageFile`/`validateVideoFile`/`createTemporaryObjectUrl`/`revokeTemporaryObjectUrl`) — MIME+size allowlist, Blob-only, blob: URLs only. No dangerouslySetInnerHTML/innerHTML anywhere.

**Deps:** react-router-dom 7.14.2→**7.18.1** (fixes 6 of 7 RR advisories). uuid 8.3.2→**11.1.1** via server override (sequelize's uuid, buf-path unused). js-yaml→3.15.0, brace-expansion→5.0.8, @babel/core→7.29.7 via **overrides** (dev-only jest/eslint transitives; `npm audit fix` was REJECTED — it bumped the jest chain and raised total vulns 5→21). setuptools already 81.0.0 (patched — no change). Final audit: server **0**, client 2 high = one advisory only.

**Documented FALSE POSITIVE needing GitHub dismissal:** react-router **GHSA-qwww-vcr4-c8h2** (RSC Mode CSRF Bypass) affects 7.12.0–8.2.0 with NO SPA-compatible fix (npm's "fix" downgrades to 7.11.0, reintroducing the other 6). FlowGuard is a Vite SPA — RSC/framework mode is NOT used → not exploitable. Do NOT jump to react-router 8.x (major, no react-router-dom v8 exists) to chase it.

**Not run:** AI Docker build (zero AI deps changed; setuptools already patched). venv `pip check` clean; torch 2.13.0+cpu/torchvision 0.28.0+cpu/cv2 4.13/fastapi import OK; insightface/onnx are NOT in the partial `.venv`. Tests after changes: server **491/491**, client 540 pass/5 pre-existing baseline fails.
