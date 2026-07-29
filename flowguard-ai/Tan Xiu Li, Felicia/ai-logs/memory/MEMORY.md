# Memory Index

- [FlowGuard Felicia scope](flowguard-felicia-scope.md) — feature ownership, hard scope rules, recognition architecture, privacy wording
- [Gate verification feature](gate-verification-feature.md) — dual gate routes, GateAccessLog auto-create, test-running gotchas, baseline failures
- [Booking time contract](booking-time-contract.md) — Singapore wall-clock↔UTC handling, +8h bug root cause, TZ=UTC to reproduce, shared datetime helpers, Driver Pass live refresh
- [Camera + QR architecture](camera-qr-architecture.md) — shared cameraSource abstraction, BarcodeDetector/ZXing + cloud OpenCV QR fallback, /api/qr/decode (Node→FastAPI), client tests use Vitest, AI venv/pytest setup
- [Security hardening](security-hardening.md) — branch fix/security-codeql-dependabot: express-rate-limit factory, CORS fail-closed, dep overrides, reset-token + react-router RSC false positives
