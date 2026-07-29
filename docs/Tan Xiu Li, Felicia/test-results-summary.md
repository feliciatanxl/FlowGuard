# Felicia, Charlisa, and repository test results

Final remediation run: 28 July 2026. No physical camera, private face image, private video, or model test image was required.

## Exact final results

| Scope | Command or selection | Result |
|---|---|---|
| Client clean install/audit | `cd client && npm ci`; `npm audit` | Passed; 625 packages installed in the host run and 0 vulnerabilities. |
| Client full | `npm test -- --run` | Passed: 60/60 files, 552/552 tests, 35.91 s. |
| Felicia client | `npx vitest run "tests/Tan Xiu Li, Felicia"` | Passed: 54/54 files, 501/501 tests, 31.30 s. |
| Felicia repeat set | Nine scan-tuning, current-user, Gate Verification, and camera-lifecycle files | Three consecutive passes: 9/9 files and 79/79 tests per run (6.11 s, 6.11 s, 6.22 s). |
| Charlisa client repeat set | Three named files plus `src/pages/CameraFeed.test.jsx` | Three consecutive passes: 4/4 files and 38/38 tests per run (4.78 s, 4.87 s, 4.79 s). |
| Client production build | `npm run build` | Passed: 744 modules. Existing 730.53 kB minified main-chunk warning remains. |
| Server clean install/audit | `cd server && npm ci`; `npm audit` | Passed; 502 packages installed and 0 vulnerabilities. |
| Server full repeat | `npm test -- --runInBand --forceExit` | Three consecutive passes: 36/36 suites and 501/501 tests each run, using six bounded processes; 104.3 s combined wall time. |
| Felicia server inventory | 25 named Jest files in the full run | 315/315 assertions pass. Direct large ad-hoc Windows combinations can still terminate Node natively; the bounded full runner retains every file. |
| Charlisa server | Seven named Jest files | Passed: 7/7 suites, 143/143 tests, 5.70 s. |
| Rate-limit repeat | Entire `rate-limit.test.js` file | Passed three consecutive runs: 16/16 assertions each run (1.94 s, 1.54 s, 1.60 s). |
| Python dependency integrity | Global and AI-venv `python -m pip check` | Passed: no broken requirements. |
| Safe AI/edge repeat set | Zone resolution, track, QR, and SecurePi bridge tests | Three consecutive passes: 29/29 per run (2.22 s, 2.20 s, 2.21 s); 9 dependency deprecation warnings per run. |
| Pi cache server | Global Python `raspberry-pi/test_pi_camera_stream.py` | Baseline pass: 9/9. The AI virtualenv does not include Flask. |

## Security, build, and container validation

- Client and server `npm audit --audit-level=low`: 0 vulnerabilities in both trees. Initial `npm ls --all`/server top-level checks completed without an actionable dependency error.
- Global and AI-venv `pip check`: no broken requirements. `pip-audit` is not installed in the environment and was not added to project requirements.
- High-confidence tracked-secret pattern scan: no match. No tracked `.env`, `node_modules`, `dist`, virtualenv, cache, private image, model, or log artefact matched the final hygiene scan.
- Client: production build passed (744 modules). The final no-cache Docker build passed on Node 24 without the prior ZXing engine mismatch. Container smoke requests returned 200 for `/`, `/login`, `/enrollment`, Driver Pass, Gate Verification, Object Detection, Detection Settings, and unknown deep links; `nosniff`, `DENY`, and `no-referrer` headers were present.
- Server: final no-cache Docker build passed with 0 audited runtime vulnerabilities. A temporary PostgreSQL 16 container allowed startup/health smoke testing; the configured origin received CORS, an arbitrary origin did not, representative Felicia `/api/bookings` and Charlisa `/api/cameras` requests returned 401, and both exposed `RateLimit-Policy: 300;w=60`.
- AI: application code, requirements, and Dockerfile were unchanged, so no unnecessary image rebuild was performed. `docker build --check` completed with no warning, dependency checks passed, and the safe suites passed three times.
- Docker reports `VITE_RECAPTCHA_SITE_KEY` as a possible build secret by name. This is an individually reviewed false positive: the Dockerfile explicitly accepts only the browser-visible public site key; the private `RECAPTCHA_SECRET_KEY` remains server runtime configuration. The main client bundle-size warning remains a performance follow-up.

## Baseline failures and decisions

| Baseline failure | Root cause | Corrected item and regression |
|---|---|---|
| Scan width and JPEG quality (three assertions) | Tests still described the older low-detail 352 px/0.62 tuning; Git history showed it was raised because face similarities were weak. | Production retains the 512 px/JPEG 0.74 accuracy defaults. A shared bounded resolver and tests cover defaults, valid 640/0.80 overrides, and rejection of lower/invalid values. |
| UserManagement `.self-tag` | The UI intentionally replaced a fragile class/text implementation with an accessible `YOU` badge. | Test now asserts the visible current-account label in the correct row and preserves RBAC/edit restrictions. |
| CameraFeed `cam_id` payload | The stale test used a non-canonical name and did not catch `Bearer null`. | Shared helper maps camera card and selector shapes to optional positive `camera_id`/`zone_id`; authenticated/local-video and missing-token tests cover the contract and request abort signal. |
| SecurePi owner-near fixture | The boxes were about 60 px apart while the configured threshold was 40 px. Production geometry was correct. | Fixture now places centres inside 40 px; a separate far-person regression proves the unattended timer is not reset incorrectly. |
| Rate-window flake | A 150 ms real-time window could elapse under cold/loaded Windows execution before the expected 429. | The assertion uses the limiter's public deterministic key reset with a long window; no production limit changed. |
| Full single-process Jest native exit | Node 24/Windows intermittently exited `-1073740791` before a Jest summary. The rate headroom test also created 360 HTTP sockets to prove two numeric thresholds, amplifying host load. | HTTP enforcement remains covered with bounded Supertest requests; exported resolved policies prove 300/min AI and 60/min read headroom without socket churn. `npm test` discovers all 36 files and runs them in six six-suite child processes. It passed three consecutive final runs and skips nothing. |

## Expected warnings and remaining limitations

- Vitest/jsdom can print canvas and navigation notices; assertions remain green.
- FastAPI uses deprecated `on_event` hooks and the current TestClient stack warns about the `httpx` to `httpx2` transition. These are warnings, not failing dependencies.
- Jest prints its standard `--forceExit` advisory for child processes. Direct single-process repeated runs remain host-sensitive, while the checked-in full command passed three consecutive final runs.
- `ai-service/test/test_webcam.py` and `test_manpower.py` require a physical webcam/display; `test_insightface.py` also needs private known-face images; `test_yolo.py` needs a local `test.jpg` and real model inference.
- Real Raspberry Pi Camera Module 3 and IMX500 `.rpk` execution was not performed. Only fake-camera, zone-rule, bridge, and cache logic ran.

Do not commit private captures or model files to fill these hardware evidence gaps.
