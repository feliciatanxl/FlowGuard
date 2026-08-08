# AI Log — Person Identity Linking, SecurePi Frame Pull & Security Camera Console
**Date:** 2026-08-08
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Opus 5)

---

## Task 1 — Link the facial-recognition database to person detection

**Prompt:** "ok i need to link my friend facial recognition database to my person detection so for hers is like a facial recognition security gate so when the person register their face they will be able to get in and the face database is using vector embedding so basically i need to link hers into mine whereby when my obj detection detects a person they need to detect that exact person to see if its authorized or unauthorized yk what i mean"

**Response summary:** Explored `ai-service/main.py`, `server/routes/yolo.js`, `server/routes/facialRecognition.js`, `server/models/User.js`, and `client/src/pages/ObjectDetection.jsx`. Established that both modules already live in **one FastAPI service** — no cross-service integration was needed.

**Key finding:** most of the wiring already existed but was dead. `_recognize_person_crop` (main.py:855) already cropped the YOLO person box, ran InsightFace on it, and matched against the enrolled `users."faceVector"` embeddings — but the result only changed the box colour and never reached the API payload. The `.od-detection-box.authorized` / `.suspicious` CSS classes also already existed and were never set by anything.

Implemented across three layers, deliberately preserving Felicia's architectural rule that **the AI cache is a matching index, never an access-control list**:

1. **AI service** — replaced `_recognize_person_crop` with `_identify_person_crop` + a shared `_match_face_embedding`, using the same locked registry snapshot, the same `_FACE_MATCH_THRESHOLD`, and `_ensure_face_cache()` retry as `/user/recognize`. Added a wall-clock TTL identity cache (`PERSON_IDENTITY_TTL_SECONDS`, default 3 s) replacing the frame-counting `FACE_RECOG_EVERY_N_FRAMES`, and de-duplicated the browser path and the server-camera loop onto one matcher. Person detections now carry `matchedUserId`, `similarity`, `faceVisible`, `identityChecked`; the matched person's **name is deliberately excluded** from the payload. Added `face_registry_ready` / `enrolled_face_count` to the analyse-frame response.
   - This also fixed the long-standing hardcoded-`0.45` **face-threshold bypass** flagged in the 2026-08-03 and 2026-08-06 audits, so `FACE_MATCH_THRESHOLD` finally has effect during YOLO person tracking.
2. **Node** — added `resolvePersonAccess` to `routes/yolo.js`, resolving `matchedUserId` against PostgreSQL with the exact rules of `POST /api/facial-recognition/recognize`: `AUTHORIZED` / `SUSPENDED` / `UNAUTHORIZED` / `UNVERIFIED`. One `findAll` per frame regardless of person count; fail-safe in both directions (a DB outage degrades to `UNVERIFIED` and still returns 200 rather than granting access or branding everyone an intruder).
3. **Client** — needed almost nothing, since the overlay already keyed off `detection.status` and `detection.label`; added a live authorized/unauthorized HUD tally.

Argued explicitly for the `UNVERIFIED` state: without it, a person facing away, a third person past the `FACE_RECOG_MAX_PEOPLE` budget, or a Cloud SQL blip would all have rendered as **UNAUTHORIZED** — accusing people because the system could not see.

Flagged two things needing the user's awareness: (1) this changes the stated privacy posture of `yolo.js`, whose comment claimed the reply "contains no identity data"; (2) `FACE_RECOG_EVERY_N_FRAMES` was removed as a knob, and one of Felicia's older AI logs references setting it.

**Verification:** server 729 passed (49 suites) including 8 new decision-matrix tests; client 723 passed (75 suites); `py_compile` clean.

**Outcome:** Delivered and verified. Did **not** wire unauthorized detections into `SecurityLogs` or the alert bridge — flagged as the obvious next step rather than silently expanding scope.

---

## Task 2 — How should I test it?

**Prompt:** "so how shd i test it"

**Response summary:** Probed the live environment first rather than giving generic instructions: found port 8501 (AI) listening but running **pre-change code**, 5173 (Vite) up, and 5001 (Node) **down**. Wrote a standalone smoke script to the scratchpad (`check_identity.py`) that grabs a webcam frame (or an image path), posts it to `/api/yolo/analyze-frame`, and prints `matchedUserId` / `similarity` / `faceVisible` per person — deliberately isolating the AI layer so no Node or browser is required. Ran it to validate the script itself; it correctly detected and reported the stale service.

Gave a four-layer plan: unit tests (already green) → restart AI + smoke script → end-to-end → four proof cases. Recommended the **self-suspension** demo as the strongest: with yourself authorized on camera, suspend your own account in `/users` and watch the box flip to red within ~3 s without re-enrolment, proving PostgreSQL is authoritative and the AI cache knows nothing about suspensions.

Confirmed from `server/routes/user.js` that enrolment already auto-calls the AI service's `/refresh`, so no manual cache refresh is needed after enrolling — and listed the real time-wasters (2-person budget, face-too-small, `Security Scan Ready: 0`).

**Outcome:** Accepted. This step directly caused the login incident in Task 6.

---

## Task 3 — Link it to the Raspberry Pi

**Prompt:** "wait but i nd to link it to my rasp pi"

**Response summary:** Found the gap: `startHardwareStream()` in `ObjectDetection.jsx` only cleared detections. In hardware mode the Pi's MJPEG was rendered raw and **FlowGuard's YOLO + face pipeline never received a single frame**, so none of Task 1's work reached the Pi feed. Also confirmed the Pi was unreachable at the time (`172.20.10.2` failing both ping and port 8001).

Presented a genuine fork via `AskUserQuestion` — laptop-side frame pull vs Pi-side crop upload vs both — noting that the Pi runs a divergent build from `~/Downloads/updated_securePi_FlowGuard` and already has one stalled Pi-side patch (the snapshot upload from 2026-08-06). **User chose laptop-side pull.**

Implemented `client/src/utils/securepiFrames.js` with two transports tried in order: `GET /snapshot` (one request per cycle, cheapest for the Pi), falling back to canvas-capturing a hidden `crossOrigin="anonymous"` copy of the MJPEG — which works only because the Pi sends `Access-Control-Allow-Origin: *`. Every failure path degrades to "no identity this cycle" and never touches the live video.

Three judgement calls, each documented in code: person-boxes-only on the hardware overlay (the IMX500 already annotates, so a full object layer would double every box); a dedicated `.od-detection-frame` element because the hardware stage is a padded 4:3 `object-fit: contain` box where the browser-mode positioning would have drifted the labels off the people; and leaving `resolveAlertSource` untouched so hardware mode still claims `'SecurePi Edge Node'` and is correctly rejected by the AI service's anti-impersonation whitelist.

**Two self-inflicted bugs found and fixed during the work:**
1. Adding the Pi URLs to the frame effect's dependency array made it re-run and **acquire the browser webcam twice** — caught by 8 of the user's own `ObjectDetectionSourceModes` tests. Fixed by using the `monitoredCameraRef` pattern already in the file for exactly this reason.
2. The hidden capture `<img>` was mounted from the same state a capture failure cleared, so it would unmount the element the next capture needed and never recover. Fixed with an independent latching flag plus a 3-cycle grace period before reporting unavailability.

Side effect: `applySecurePiResult` was overwriting `peopleCount` with `null` every 5 s because this Pi build 404s `/people-count`; now it only takes the count when the Pi actually reports one, giving hardware mode a live count for the first time (open item #2 from the 2026-08-06 log).

**Verification:** client 737 passed (76 suites) including 14 new `securepiFrames` tests; server 729 passed; ESLint clean.

**Outcome:** Delivered. Explicitly reported as **unverified against real hardware** — the Pi was offline throughout, so which of the two transports goes live was never confirmed. Recorded in the `securepi-pi-runtime` memory as an open item.

---

## Task 4 — Retry, now on the hotspot

**Prompt:** "can try again i on hotspot alrd"

**Response summary:** Re-probed. Laptop on `172.20.10.6`; `172.20.10.2` answered ping but port 8001 was closed. Rather than stopping at the documented `--stream` explanation, checked the ARP entry and found MAC `88-A2-9E-D0-12-13`, which is not a Raspberry Pi OUI, and swept `.1–.14` for ports 8001 and 22 — nothing open anywhere on the subnet.

Reported that **port 22 being closed was the tell**: if the Pi were connected and SecurePi simply were not running, SSH would still answer. Concluded the Pi was not on the hotspot and something else held the `.2` lease.

**Outcome:** Diagnosis delivered; user went to check the Pi.

---

## Task 5 — The Pi reports 172.20.10.2

**Prompt:** "the pi the ip address after running hostname -I is 172.20.10.2"

**Response summary:** Re-probed live: ping succeeded, ports 8001/22/5000/8000 all closed, `/health` refused. Laid out the two remaining explanations (the Pi genuinely is `.2` with nothing running, vs. a DHCP conflict with another device) and gave a single discriminating command — `cat /sys/class/net/wlan0/address; hostname -I; ss -tln` — with the MAC to compare against and the branch to follow for each result. Also noted that `hostname -I` prints *every* interface, so a Pi answering on Ethernet while its Wi-Fi is elsewhere would explain the reading.

**Outcome:** Unresolved in-session — the Pi never came up, so `/snapshot` support remains unverified.

---

## Task 6 — "what u do to the login dont touch revert it back"

**Prompt:** "eh what u do to the login dont touch revert it back"

**Response summary:** Did not revert anything reflexively and did not simply deny it — verified instead. `git status` and a filtered `git diff --name-only` confirmed **zero login/auth files touched**: the six modified files were all object-detection (`main.py`, `yolo.js`, `ObjectDetection.jsx/.css`, `.env.example`, one test).

Then checked the environment and found port 5001 down. Offered two candidate causes and how to tell them apart: Node not running (connection error), versus **self-suspension caused by my own Task 2 testing instruction** — `user.js:247` returns 403 "Account suspended" and suspension bumps `tokenVersion`, killing existing sessions. Gave both remedies (another FM reactivates, or direct SQL). Attempted a read-only `SELECT` on `users` to confirm which; **blocked by the permission classifier**, reported that plainly rather than working around it.

**Outcome:** Concern addressed factually; no code reverted, because none of it was login-related.

---

## Task 7 — "what happened to this" (Vite proxy ECONNREFUSED)

**Prompt:** "so what happened tothis 1:16:57 PM [vite] http proxy error: /user/login Error: connect ECONNREFUSED 127.0.0.1:5001"

**Response summary:** Started the Node server in the background and read its output. **Real root cause, unrelated to any session change:** `server/index.js:122` validates all 15 Sequelize models against the live database and only opens port 5001 if that succeeds — and it was failing:

```
Missing required columns for IncidentLog: resolvedAt
Missing required columns for SupportTicket: category, isArchived
```

The server crashed on startup, the port never opened, and *every* route was down — login was just the first one hit. The three columns come from migrations dated 2026-08-03 that arrived in the `deploy/staging` merge and had never been run locally.

Read `server/migrations/README.md` for the documented procedure, confirmed the database was **local** (`localhost/flowguard`, Postgres 16 — not shared Cloud SQL), and that the migrations are additive, idempotent (`ADD COLUMN IF NOT EXISTS`) and transactional. Applied all three via `psql`, reading `DB_PWD` from `.env` without echoing it. Nodemon restarted to `FlowGuard Server is FULLY READY on 0.0.0.0:5001`; verified `/user/login` returns 400 on junk credentials instead of refusing the connection.

Noted that `migrations/README.md` documents the psql path as PostgreSQL **18** while the machine has **16**.

**Outcome:** Resolved and verified. Login restored.

---

## Task 8 — Split identity into its own "Security Camera" side panel

**Prompt:** "wait am i able to remove the person unauthorized / authorized part from my object detection navigation and create another side panel specifically for that? ( together with like my object detection stuff ) and maybe namethe side panel as security camera"

**Response summary:** Confirmed feasible and read `App.jsx` / `Sidebar.jsx` first. Decided one point unilaterally and said so: Object Detection **keeps plain person boxes**, because removing person detection entirely would break unattended-object alerts, which depend on person-proximity to decide a bag was abandoned.

Raised the material fork via `AskUserQuestion` with ASCII previews — full console with its own feed (extracting a shared hook), identity-panel-only, or duplicate-the-page. **User chose the shared-hook full console.**

Executed in three independently verifiable stages:
1. Extracted `client/src/hooks/useCameraFeed.js` (~450 lines: source switching, SecurePi health poll and laptop fallback, snapshot/canvas frame pull, analyse round-trip) and rewired `ObjectDetection.jsx` onto it. Deliberately verified this stage on its own — the user's existing `ObjectDetectionSourceModes` tests, which assert exact `getUserMedia` call counts and SecurePi poll teardown, passing untouched was the evidence the extraction was faithful.
2. Built `SecurityCamera.jsx` + `SecurityCamera.css` (verdict roster with name, role, verdict and face-match %), added the `/security-camera` route under `ACCESS.FM_ONLY` and the sidebar link.
3. Stripped identity from Object Detection's overlay and restored its original no-overlay behaviour on the hardware feed.

Two mid-task corrections: a stray `};` left by a scripted block deletion (caught by ESLint's "return outside of function"), and a first attempt at the new tests that failed because jsdom has no video pipeline (`videoWidth` is always 0, so the analyse loop never fires) — rewritten to mock `useCameraFeed` and assert what the pages render, with the engine's own behaviour left to the existing tests.

Also updated `mediaPreview.test.js`, whose static source scan looked for `createTemporaryObjectUrl` in `ObjectDetection.jsx` after that code moved into the hook; pointed it at the hook and **added** an assertion that the page kept no second unvalidated upload path, so the safety property was preserved rather than weakened.

**Verification:** client 745 passed (77 suites); server 729 passed; ESLint clean across `client/src`.

**Outcome:** Delivered.

---

## Task 9 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the repo convention `flowguard-ai/<Full Name>/ai-logs/`, resolving `<name>` from the session's git user `251787T` → `Tan Yu En, Charlisa`. Checked the working tree before writing so the log would not claim code that is no longer present (see below).

**Outcome:** This file.

---

## State of the tree at time of writing

Checked rather than assumed. The repository has advanced past this session — HEAD is now `5997e3b`, with later commits including `a059d6e fix: render face-sized identity boxes in security camera`, `dda9cc9 feat: persist detection snapshots in private GCS`, and merges from `ai-chatbot` and `fix/snapshot-refresh-timestamp`.

Of this session's work:

- **`client/src/pages/SecurityCamera.jsx` exists and is tracked** — the Security Camera console survived and was iterated on further. It is now **self-contained**: it imports `getHardwareStreamUrl`, `testSecurePiConnection`, `buildAnalyzeFramePayload` etc. directly rather than going through a shared hook.
- **Not present in the tree:** `client/src/hooks/useCameraFeed.js`, `client/src/utils/securepiFrames.js`, `client/src/css/SecurityCamera.css`, `client/tests/Tan Yu En, Charlisa/SecurityCameraConsole.test.jsx`, `client/tests/Tan Yu En, Charlisa/SecurePiFrames.test.js`.
- **`ai-service/main.py` no longer contains `_identify_person_crop`**, and **`server/routes/yolo.js` no longer contains `resolvePersonAccess`** — the specific YOLO-person → enrolled-face linking and the Node-side access decision implemented in Task 1 are not in the current tree.
- The database migrations applied in Task 7 are a change to the local database, not the repo, and remain applied.

So the *feature* survived in a later, differently-implemented form; the implementation described in Tasks 1, 3 and 8 is not what is currently checked out. Anyone reading this log for the current behaviour should read `SecurityCamera.jsx` and `main.py` as they stand, not this description.

---

## Open items carried out of this session

1. **`/snapshot` support on the Pi never verified.** The Pi was offline for the entire session (Tasks 3–5). `curl http://<pi-ip>:8001/snapshot` settles it in one command.
2. **Pi not on the hotspot.** `hostname -I` reported `172.20.10.2`, but that address had no open ports — not even SSH — and its MAC is not a Raspberry Pi OUI. Compare `cat /sys/class/net/wlan0/address` against `88:a2:9e:d0:12:13` to tell a DHCP conflict from a dead service.
3. **Unauthorized-person detections are not audited.** Nothing writes to `SecurityLogs` or fires a detection alert when an unknown person is seen on a monitored camera, unlike the gate flow.
4. **`migrations/README.md` documents PostgreSQL 18**; this machine runs 16. Whoever follows those instructions literally will hit a wrong path.
5. **Migrations are hand-run with no ledger.** Task 7's failure mode — code merged forward, schema left behind, server refuses to boot with an error that surfaces as a login failure — will recur on every teammate's machine and gives no hint that migrations are the cause.
6. **Snapshot upload patch still unwritten** (carried from 2026-08-06); the Pi-side prompt is ready but was never run.
