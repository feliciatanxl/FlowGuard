# AI Reflection — FlowGuard Final Project Stage (Tan Xiu Li, Felicia)

- **Reflection date:** 2 August 2026
- **Project stage:** Week 16 / final submission preparation
- **Primary feature:** Facial Recognition & Access Management
- **Secondary feature:** Smart Logistics & Loading Bay Management

## How I used AI during the project

I used AI throughout FlowGuard as a development and review assistant, mainly through
**Claude Code** and **Codex**. I also used Gemini occasionally for general brainstorming and
reference, with the available shared links recorded in
[`ai-logs/logs_link.md`](./ai-logs/logs_link.md). The detailed local prompt archive is mainly
from Claude Code and Codex: it contains **43 dated FlowGuard sessions and 146 user prompts**
from 14 June to 2 August 2026 in [`ai-logs/`](./ai-logs/).

The logs show that I did not use one prompt to generate the whole project. My use of AI changed
as the project progressed. At the start, I used it to understand setup problems such as the
PostgreSQL `vector` error, camera lag, poor frame quality and running the Node, React and Python
services together. During the main development stage, I used it to plan and implement my facial
recognition and Smart Logistics workflows. Near the deadline, most of my prompts shifted towards
integration bugs, responsive UI, security alerts, dependency vulnerabilities, Cloud Run readiness,
full regression testing and making the documentation match the real code.

## What AI helped me do

For **Facial Recognition & Access Management**, AI helped me work through the complete flow from
enrolment to access review. This included the camera and manual-upload enrolment paths, the
InsightFace encode/recognise endpoints, face tracking and bounding-box feedback, basic head-turn
liveness, Gate Scanner and V-Patrol behaviour, attendance/security logging, evaluation participants,
and the FM manual-review workflow. It also helped scaffold tests for enrolment, recognition states,
RBAC, attendance, security events, denied outcomes and the camera fallbacks.

For **Smart Logistics & Loading Bay Management**, AI helped with booking CRUD, role-scoped booking
views, Singapore date/time handling, loading-bay overlap checks, one-to-two-hour booking validation,
WhatsApp real/mock-safe notifications, the public Driver Pass, QR scanning, manual reference entry,
plate OCR with manual correction, FM-only entry/exit decisions, gate audit logs and the next-driver
notification flow. Later prompts also covered keeping the Driver Pass live after booking edits and
supporting phone testing through a local hotspot without hardcoding a temporary IP into source code.

AI was also useful for work that affected whether my features could survive integration. It helped
trace merge regressions, database 500 errors, React CommonJS/ESM icon and QR-component crashes,
Cloud Run timezone differences, CORS and API-base behaviour, Pi-camera/webcam source selection,
CodeQL and Dependabot findings, test flakiness, Docker smoke checks, and final rubric/documentation
audits. For documentation, I used it to draft API and schema explanations, use cases, change reports,
test evidence and the Week 13 demo flow, but I checked these against the implementation before
accepting them.

## What I personally decided and reviewed

The AI could suggest code, but I remained responsible for the feature rules and the final decision.
The main decisions I reviewed were:

- **Roles and ownership:** FM manages facial access, security review and facility-level gate
  decisions. Tenants and Staff only see data allowed for their unit. Staff may create a booking for
  their unit but cannot approve gate entry/exit or change facility-level booking status. Public
  drivers only receive the minimum Driver Pass information needed for the visit.
- **Biometric privacy:** off-boarding must remove the user's face vector and attendance-related
  personal data while keeping a useful audit record in anonymised form. I chose anonymisation instead
  of deleting the entire security history because the event still matters for accountability.
- **Data accuracy:** the implemented face embedding is stored as PostgreSQL `FLOAT[]`
  (`ARRAY(FLOAT)`), not a `pgvector VECTOR(512)` column. I corrected AI-written documentation that
  claimed otherwise rather than changing the report to sound more advanced than the code.
- **Fallbacks:** Raspberry Pi Camera Module 3 can be the preferred physical source, but webcam,
  image upload, manual booking reference and manual plate correction remain available. These
  fallbacks are important because the project is a PoC and the final demonstration environment may
  not always have the same camera or network.
- **Security boundaries:** I checked both the frontend route restrictions and backend enforcement.
  Hiding a menu item is not enough; protected operations also require verified JWT/RBAC, tenant
  ownership checks and FM-only server routes. Secrets stay in ignored environment files, while the
  committed examples contain placeholders only.
- **Scope control:** several prompts explicitly told the assistant not to modify teammate features,
  change branches, expose `.env` values or weaken existing flows. When a result was incomplete,
  outside the requested scope or based on an incorrect assumption, I corrected the prompt, narrowed
  the task or rejected that part of the output.

## Examples of AI output I accepted, adjusted or rejected

I accepted AI-generated scaffolding when it matched the existing architecture and I could verify it,
for example the manual security-review fields, booking-duration validation, Pi-first camera helper,
dashboard refresh behaviour and focused Jest/Vitest regression tests.

I adjusted suggestions when the general approach was useful but the project rule was different. One
example was changing `ProtectedRoute` to support an `allowedRoles` array because some pages are shared
by more than one authorised role. I also kept the three zone-selectable detection types separate from
the larger seven-entry incident mapping so a configuration cleanup would not silently break existing
Object Detection validation.

I rejected or corrected suggestions when they were inaccurate or risky. The clearest example was the
incorrect `pgvector` documentation. During dependency hardening, I also did not accept a broad
`npm audit fix` result that increased dependency problems; the final changes used reviewed, narrow
version updates instead. I did not add an unauthenticated testing endpoint, wildcard credentialed
CORS, a cloud proxy into a private Pi, or a production fallback that could send a `localhost` Driver
Pass link. These choices made the solution less flashy, but more truthful and safer.

## How I checked the work

I did not treat an AI response as proof that a task was complete. I repeatedly read the changed files,
checked `git status` and the active branch, compared the result with the requested roles and data flow,
and used both focused and full regression tests. As the project grew, the test totals also increased;
the final 2 August hardening log records:

- backend syntax checks passing and **40 suites / 578 tests passing**;
- the clean full client run passing **64 files / 581 tests**;
- the client production build passing;
- the Raspberry Pi cache-server tests passing **9/9**; and
- no new lint errors from the final feature changes, while older repository-wide lint debt was
  reported separately instead of being hidden.

I also manually checked the user journeys that are difficult to judge from unit tests alone:
enrolment by camera and upload, recognition feedback, access/security log creation, FM review,
role-based navigation, booking creation and edit, Driver Pass display, gate scanning/manual fallback,
and phone access over the same local network. Where the AI environment could not access an
authenticated browser, physical camera, private face images, Google Cloud metadata or the current
hotspot address, I kept that as a stated limitation and performed the available manual check myself.

The archived logs are intentionally not edited into a perfect success story. They include repeated
prompts, interrupted work, environment failures, tests that exposed stale fixtures, and tasks that
needed a second pass. This is more representative of how I actually used AI: generate or diagnose,
review the evidence, correct the scope, test, and then decide whether to keep the result.

## What I learned from using AI

The most useful lesson was that AI works better when I give it the current branch, protected scope,
existing behaviour, exact error output and a clear verification requirement. Broad prompts sometimes
produced confident answers that did not match the repository. Smaller prompts with explicit files,
roles, failure cases and “do not change” boundaries were easier to review and caused fewer regressions.

I also learned that passing unit tests alone is not enough for a full-stack system. Several important
problems only appeared across boundaries: Singapore time converted twice between browser and Cloud
Run, a React package exported a module object instead of a component, a phone could not use a laptop's
`localhost`, and a public HTTPS site cannot directly call an HTTP camera on a private LAN. Working
through these issues helped me understand the actual request path and deployment environment instead
of only editing the component where an error appeared.

Near the deadline, I became more selective. I focused less on adding new features and more on
stabilising the integrated journeys, preserving teammate work, fixing security findings, documenting
limitations and collecting reproducible evidence. AI made the review faster, but deciding what was
safe, accurate and within my responsibility still required my own judgement.

## Remaining limitations and honest PoC boundary

FlowGuard is an academic proof of concept, not a production biometric access product. The current
head-turn liveness and cosine-similarity threshold are not certified anti-spoofing. Final automated
checks covered camera adapters and fake/test sources, but did not replace a controlled evaluation with
the physical Camera Module 3/IMX500, private known-face images and varied real lighting. A cloud-hosted
browser also cannot directly reach a private-LAN HTTP Pi; Pi mode is intended for a local kiosk or
laptop on the same network, with webcam/manual fallbacks elsewhere.

Security logs still have some soft/name-based relationships where a proper user foreign key would be
stronger. Rate limiting uses an in-process store and would need a shared production store for multiple
instances. WhatsApp delivery depends on valid external credentials and is therefore mock-safe by
default. The client still has a large main-bundle warning, and final deployed Cloud SQL/IAM/rollback
evidence must be captured separately without exposing secrets.

These limitations are included because a convincing final reflection should show what I can defend,
not claim that every prototype feature is production-ready. Overall, AI contributed substantially to
planning, implementation, debugging, testing and documentation, but I reviewed the code and retained
responsibility for the requirements, privacy choices, accepted/rejected changes, manual testing and
final submission evidence.

## Addendum — 3–4 August 2026 (Pi/SecurePi integration and documentation sync)

After the 2 August reflection above I continued with a short, integration-and-documentation-focused
stretch, and the archive now holds **52 dated FlowGuard sessions and 168 user prompts from 14 June to
4 August 2026**. A few lessons from these last sessions are worth recording specifically.

- **Browser-to-private-Pi connectivity is not the same as Cloud Run backend connectivity.** The two
  Raspberry Pi camera paths run entirely between the laptop browser and the Pi over the shared
  hotspot/LAN; Cloud Run is never in that path and must never be asked to proxy a private Pi address.
  The deployed backend connectivity (JWT/API calls, edge-alert ingestion) is a separate concern. I
  kept these two mental models apart when wiring the Pi 4 facial node and the Pi 5 SecurePi stream so
  that a local camera failure never looked like a cloud outage and vice-versa.
- **Test the direct health/MJPEG endpoints, not an assumed richer contract.** An early version of the
  dual-Pi work assumed the SecurePi service would expose `/people-count` and `/snapshot`. The real
  service only answered `/health` (`status:"online"`, `latest_frame_age_seconds`) and `/video_feed`.
  The most useful debugging step was checking those exact endpoints directly in the browser: a
  `/people-count` `404` without a CORS header surfaced as a CORS `TypeError`, which the client was
  wrongly treating as "SecurePi unreachable". Fixing it meant keeping `/health` authoritative, treating
  any optional-endpoint failure after health as "unsupported", and using the first MJPEG frame (with a
  bounded ~8-second timeout) as the real hardware confirmation before falling back to the laptop webcam.
- **Independent Pi handling matters.** The Pi 4 facial node (Felicia) and the Pi 5 SecurePi node
  (Charlisa) must be configured and probed independently, with their own URLs and their own fallbacks,
  so one being offline never disables the other or the cloud data.
- **Avoiding accidental teammate scope.** My read-only pre-PR audits repeatedly caught teammate
  incident-tracking / support-dashboard files being pulled into my branch through a merge, exceeding my
  declared Pi/attendance/retention scope. I treated that as a blocker to resolve before any PR rather
  than quietly shipping another member's work under my change.
- **The Pi 5 SecurePi runtime that actually worked** is the separate, externally-maintained repository
  [charlisaa/updated_securePi_FlowGuard](https://github.com/charlisaa/updated_securePi_FlowGuard).
  FlowGuard connected to it, the health endpoint responded, the MJPEG stream opened, and FlowGuard
  displayed the Pi 5 stream as its active source. That is a verified browser-integration result only —
  I did not treat a working stream as proof of model accuracy, long-term reliability, or production
  security, which still need physical validation on the intended hardware. FlowGuard configures and
  consumes that service; it does not own or deploy the SecurePi runtime.
