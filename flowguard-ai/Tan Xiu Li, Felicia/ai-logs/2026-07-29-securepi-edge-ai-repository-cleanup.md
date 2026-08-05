# AI Log — SecurePi Edge-AI Repository Cleanup
**Date:** 2026-07-29
**Branch:** main
**Tool:** Claude Code (claude-opus-4-8)
**Project:** FlowGuard
**Source session:** `547bc8d8-72df-4a46-88a2-dfb66e1769f8`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Internal auto-review, subagent, command, and tool-notification records are omitted.

---

## Task 1 — I have manually combined two existing projects, SecurePi and SecurePi2, into this singl…

**Prompt date/time:** 2026-07-29 15:13:28 SGT

**Prompt (verbatim):**

> I have manually combined two existing projects, SecurePi and SecurePi2, into this
> single repository. Their files are currently mixed together in the repository
> root.
>
> This repository must become a clean Raspberry Pi edge-AI project for FlowGuard.
> The Raspberry Pi will run the Sony IMX500 AI Camera runtime, while model training
> and compilation should remain separate and normally run on a computer or Google
> Colab.
>
> Current root files include items such as:
>
> - securePi.py
> - app_gui.py
> - compile_imx500.py
> - dataset_prep.py
> - export_onnx.py
> - run_pipeline.py
> - train.py
> - verify_dataset.py
> - requirements.txt
> - LABELS.md
> - MODELS.md
> - implementation_plan.md
> - README.md
> - LICENSE
> - .gitignore
> - presets/
> - tests/
> - .github/
>
> Important safety rules:
>
> 1. Inspect every file before editing or moving anything.
> 2. Do not delete working code merely because it looks duplicated.
> 3. Do not push, merge, deploy or modify the remote repository.
> 4. Do not run destructive Git commands.
> 5. Do not create fake model files or fake successful build results.
> 6. Preserve the current Git history.
> 7. Show me the proposed reorganisation plan before implementing it.
> 8. Check whether any files from the two original projects may have overwritten
>    one another when I combined them.
> 9. Run git status before and after the work.
> 10. Do not change application behaviour unnecessarily.
>
> Target repository structure:
>
> SecurePi_FlowGuard/
> ├── edge/
> │   ├── securePi.py
> │   ├── requirements-pi.txt
> │   ├── presets/
> │   │   ├── common.args
> │   │   ├── demo.args
> │   │   ├── lobby.args
> │   │   ├── kitchen.args
> │   │   └── carpark.args
> │   └── tests/
> │
> ├── training/
> │   ├── dataset_prep.py
> │   ├── verify_dataset.py
> │   ├── train.py
> │   ├── export_onnx.py
> │   ├── compile_imx500.py
> │   ├── run_pipeline.py
> │   └── requirements-training.txt
> │
> ├── desktop/
> │   ├── app_gui.py
> │   └── requirements-desktop.txt
> │
> ├── models/
> │   ├── labels.txt
> │   └── README.md
> │
> ├── deploy/
> │   └── securepi.service
> │
> ├── docs/
> │   ├── LABELS.md
> │   ├── MODELS.md
> │   └── implementation-plan.md
> │
> ├── tests/
> │   └── shared or off-device tests when appropriate
> │
> ├── .github/
> ├── .gitignore
> ├── LICENSE
> └── README.md
>
> First phase: inspection
>
> Before editing, report:
>
> - What every existing root file is responsible for
> - Which project it most likely came from
> - Duplicate or conflicting files
> - Imports and paths that will break after moving files
> - Tests that need updating
> - Dependencies required only for Raspberry Pi runtime
> - Dependencies required only for training
> - Dependencies required only for the desktop GUI
> - Any missing files referenced by the code
> - Whether an actual .rpk model currently exists
> - Whether labels and model output classes are consistent
> - Whether the IMX500 parser supports the custom model output
>
> After presenting the inspection and file-movement plan, proceed with the
> implementation unless a serious destructive conflict is discovered.
>
> Functional model classes
>
> The custom model uses:
>
> 0 person
> 1 backpack
> 2 handbag
> 3 suitcase
> 4 rat
> 5 mouse
>
> These must be separated into three functional categories:
>
> person_labels:
> - person
>
> unattended_object_labels:
> - backpack
> - handbag
> - suitcase
>
> pest_labels:
> - rat
> - mouse
>
> Do not treat rat or mouse as unattended bags.
>
> Required runtime behaviour
>
> Person detections:
> - Used for person tracking
> - Used for unattended-object owner association
>
> Backpack, handbag and suitcase:
> - Use unattended-object tracking
> - Associate an object with a nearby person when appropriate
> - Start an unattended timer after the owner leaves
> - Trigger an alert only after the configured threshold
> - Avoid repeated alerts for the same continuously unattended object
>
> Rat and mouse:
> - Must use separate pest-detection logic
> - Must not require an owner
> - Must not enter bag-owner association logic
> - Must support a separate confidence threshold
> - Must support confirmation using either duration or consecutive frames
> - Must support an alert cooldown
> - Must create a snapshot
> - Must log the pest class and timestamp
> - Must avoid repeatedly alerting for the same continuously visible pest
>
> Add configurable CLI arguments equivalent to:
>
> --person-labels person
> --unattended-object-labels backpack handbag suitcase
> --pest-labels rat mouse
> --pest-confidence 0.50
> --pest-confirmation-time 2
> --pest-alert-cooldown 30
>
> Preserve backward compatibility where reasonably possible, but remove any
> configuration that incorrectly includes rat and mouse as bag labels.
>
> Preset behaviour
>
> Presets should still work after securePi.py is moved into edge/.
>
> Support commands such as:
>
> python edge/securePi.py @edge/presets/lobby.args
>
> and:
>
> python edge/securePi.py @edge/presets/lobby.args \
>   --model models/imx500_custom_securepi.rpk \
>   --labels models/labels.txt \
>   --headless
>
> Resolve preset, model, label, snapshot and log paths reliably regardless of the
> current working directory.
>
> Do not hardcode my Windows path or a specific Raspberry Pi username.
>
> Dependency separation
>
> Do not keep one combined requirements.txt.
>
> Create:
>
> 1. edge/requirements-pi.txt
>    - Only lightweight Python packages genuinely needed by the Pi runtime
>    - Document Raspberry Pi OS packages such as picamera2, OpenCV and IMX500
>    - Do not include training libraries
>
> 2. training/requirements-training.txt
>    - Ultralytics
>    - ONNX-related dependencies
>    - Dataset and training dependencies
>    - Any desktop-only package should not be included unless training needs it
>
> 3. desktop/requirements-desktop.txt
>    - GUI and desktop inference dependencies only
>
> Do not make the Raspberry Pi install:
>
> - FiftyOne
> - Ultralytics
> - PyTorch training packages
> - ONNX export tools
> - IMX500 compilation tools
>
> The normal workflow should be:
>
> Computer or Colab:
> dataset preparation → training → ONNX export → IMX500 compilation
>
> Raspberry Pi:
> load the compiled .rpk → run edge detection and alerts
>
> IMX500 compilation safety
>
> Review compile_imx500.py and the pipeline scripts carefully.
>
> Required changes:
>
> - Detect when imx500-converter is unavailable
> - Display a clear installation/setup error
> - Use subprocess with check=True or explicitly validate the return code
> - Do not print a success message after a failed command
> - Verify the output .rpk exists
> - Verify the .rpk size is greater than zero
> - Return a non-zero exit code on failure
> - Do not create an empty placeholder .rpk
> - Clearly distinguish compilation success from runtime compatibility
>
> Also investigate whether the custom YOLO model output can be decoded by the
> existing IMX500 detection parser.
>
> Do not assume an SSD, NanoDet or standard YOLO parser is compatible.
>
> Document:
>
> - Expected output tensor format
> - Required metadata
> - Required post-processing
> - Label ordering
> - Any unresolved compatibility issue
> - What must be tested on the physical Raspberry Pi
>
> Logging
>
> Use a configurable runtime data directory such as:
>
> runtime/
> ├── alerts/
> ├── logs/
> └── snapshots/
>
> This directory must be excluded from Git.
>
> Event logs should contain enough information to identify:
>
> - Timestamp
> - Event type
> - Detection class
> - Confidence
> - Track ID when available
> - Snapshot path
> - Zone or preset when available
>
> Repository cleanup
>
> Update .gitignore to exclude at minimum:
>
> dataset/
> fiftyone/
> runs/
> runtime/
> alerts/
> logs/
> snapshots/
> venv/
> .venv/
> __pycache__/
> .pytest_cache/
> *.pyc
> *.pt
> *.onnx
> *.rpk
> .env
>
> Do not commit:
>
> - Dataset images
> - Dataset labels generated during training
> - Model weights
> - Compiled model files
> - Virtual environments
> - Runtime snapshots
> - API keys
> - Secrets
> - Training run output
>
> Keep models/README.md explaining where the following should be manually placed:
>
> models/imx500_custom_securepi.rpk
> models/labels.txt
>
> README requirements
>
> Merge the useful content from the existing documentation into one accurate root
> README.
>
> The README should include:
>
> - Project overview
> - Architecture
> - Repository structure
> - Supported classes
> - Person, unattended-object and pest behaviour
> - Raspberry Pi hardware requirements
> - Sony IMX500 camera requirement
> - Raspberry Pi installation
> - Training workflow
> - Model deployment workflow
> - Preset usage
> - Headless execution
> - Testing
> - Troubleshooting
> - Known model-parser limitations
> - Privacy note about locally captured images
> - Clear statement that .rpk files are generated separately and not committed
>
> Do not claim that a model or feature has been validated on physical hardware
> unless the repository contains evidence.
>
> Systemd deployment
>
> Create deploy/securepi.service as a safe template.
>
> Requirements:
>
> - Run securePi.py in headless mode
> - Use an EnvironmentFile for configurable paths/settings
> - Restart on failure
> - Do not run as root unless genuinely required
> - Use placeholders instead of assuming a username
> - Document how the user should replace absolute paths
> - Do not hardcode secrets inside the service file
>
> Testing
>
> Preserve and update the existing tests.
>
> Add tests proving:
>
> 1. Rat detections do not enter unattended-bag tracking.
> 2. Mouse detections do not enter unattended-bag tracking.
> 3. Pest alerts require the configured confirmation threshold.
> 4. Pest cooldown prevents repeated alerts.
> 5. A pest alert includes the detected class.
> 6. Pest event logging works.
> 7. Backpacks, handbags and suitcases still use unattended-object logic.
> 8. Person detections still support owner association.
> 9. Preset paths still resolve after the reorganisation.
> 10. Compilation failure does not report success.
> 11. An absent or empty .rpk output is treated as failure.
>
> Tests must run without requiring a physical Raspberry Pi or camera by mocking
> hardware-specific modules.
>
> Do not weaken existing tests just to make them pass.
>
> Implementation approach
>
> Work incrementally:
>
> 1. Inspect and report.
> 2. Create the target directories.
> 3. Move files using Git-aware moves where possible.
> 4. Repair imports and paths.
> 5. Separate dependencies.
> 6. Refactor label categories.
> 7. Implement pest handling.
> 8. Improve compilation failure handling.
> 9. Update presets.
> 10. Update documentation.
> 11. Add and update tests.
> 12. Run validation.
>
> At the end, provide:
>
> - Final directory tree
> - File movement summary
> - Files added, changed and removed
> - Important behaviour changes
> - Exact test commands used
> - Test results
> - Lint or syntax-check results
> - Remaining hardware-dependent checks
> - Any model-parser compatibility risk
> - git status output
> - Suggested commit message
>
> Do not commit or push the changes. Stop after local implementation and
> validation so I can review everything first.

**Response summary:** The archived final response for this task stated:

> Everything is implemented, validated, and left uncommitted for your review. Here is the complete summary.
>
> ## Final directory tree
>
> ```
> SecurePi_FlowGuard/
> ├── edge/                          # runs ON the Pi
> │   ├── securePi.py                # refactored: pest logic, path/runtime resolution
> │   ├── requirements-pi.txt        # NEW — lightweight runtime deps only
> │   ├── presets/{common,demo,lobby,kitchen,carpark}.args   # updated (--zone, pests)
> │   └── tests/test_securepi.py     # moved + updated + new tests (25)
> ├── training/                      # runs off-device
> │   ├── dataset_prep.py verify_dataset.py train.py export_onnx.py
> │   ├── compile_imx500.py          # hardened failure handling
> │   ├── run_pipeline.py            # propagates compile failure
> │   └── requirements-training.txt  # NEW
> ├── desktop/
> │   ├── app_gui.py                 # moved (unchanged)
> │   └── requirements-desktop.txt   # NEW
> ├── models/
> │   ├── labels.txt                 # NEW — 6 classes in index order
> │   └── README.md                  # NEW — placement + parser caveat
> ├── deploy/
> │   ├── securepi.service           # NEW — systemd template (non-root, EnvironmentFile)
> │   └── securepi.env.example       # NEW — config template, no secrets
> ├── docs/
> │   ├── LABELS.md MODELS.md        # moved + updated
> │   └── implementation-plan.md     # moved + rat/mouse bug fixed
> ├── tests/test_compile_imx500.py   # NEW — off-device compile tests (6)
> ├── .gitignore  README.md  LICENSE
> ```
>
> ## File-movement summary (all plain moves — nothing tracked was moved, so history is intact)
> `securePi.py`→`edge/`; `presets/`→`edge/presets/`; `tests/test_securepi.py`→`edge/tests/`; `dataset_prep.py verify_dataset.py train.py export_onnx.py compile_imx500.py run_pipeline.py`→`training/`; `app_gui.py`→`desktop/`; `LABELS.md MODELS.md`→`docs/`; `implementation_plan.md`→`docs/implementation-plan.md`.
>
> ## Files added / changed / removed
> - **Added (11):** 3 requirements files, `models/labels.txt`, `models/README.md`, `deploy/securepi.service`, `deploy/securepi.env.example`, `tests/test_compile_imx500.py` (+ the two dirs `deploy/`,`models/`).
> - **Changed:** `edge/securePi.py`, `training/compile_imx500.py`, `training/run_pipeline.py`, all 5 presets, `.gitignore`, `README.md`, `docs/*`, `edge/tests/test_securepi.py`.
> - **Removed:** root `requirements.txt` (superseded by the 3 split files — its content was Pi-only and is preserved in `edge/requirements-pi.txt`). No code was deleted.
>
> ## Important behaviour changes
> 1. **Pest path added.** `PestTracker` with `--pest-labels/--pest-confidence/--pest-confirmation-time/--pest-confirmation-frames/--pest-alert-cooldown`. Rodents never touch owner/bag logic; confirm by duration **or** frames; one alert then cooldown.
> 2. **Labels split into three categories.** `--unattended-object-labels` (with `--bag-labels` kept as a **backward-compatible alias**); rat/mouse removed from any bag config (incl. the `implementation-plan.md` bug).
> 3. **Runtime dirs** `runtime/{snapshots,logs,alerts}` (git-ignored), configurable via `--runtime-dir`/`--zone`; richer `events.csv` schema (time, event_type, label, confidence, track_id, zone, duration_sec, snapshot).
> 4. **Robust path resolution** for preset/model/labels/runtime regardless of CWD; no hardcoded Windows path or Pi username anywhere.
> 5. **Compilation fails loudly** (missing converter, non-zero exit, missing/empty `.rpk` → exception + non-zero exit; never a fake success; never a placeholder `.rpk`; success is explicitly distinguished from runtime compatibility).
>
> ## Test commands & results
> ```bash
> python -m pytest -q                       # 31 passed
> python -m pytest edge/tests/ -q           # 25 passed
> python -m pytest tests/ -q                # 6 passed
> python edge/tests/test_securepi.py        # ALL 25 TESTS PASSED (standalone)
> python tests/test_compile_imx500.py       # ALL 6 TESTS PASSED (standalone)
> ```
> Covers every one of your 11 required proofs (rat/mouse not in bag tracking, pest confirmation threshold, pest cooldown, pest alert-includes-class, pest logging, bags still unattended-tracked, person→owner association, preset resolution after reorg, compilation-failure-≠-success, absent/empty `.rpk`=failure). No existing test was weakened; hardware is fully mocked.
>
> ## Lint / syntax
> `python -m py_compile` on all 10 modules → **all OK**. `securePi.py -h` exits 0 off-device and lists every new flag.
>
> ## git status (after)
> ```
>  M .gitignore
>  M README.md
> ?? LICENSE  deploy/  desktop/  docs/  edge/  models/  tests/  training/
> ```
> Nothing committed or pushed. Remote untouched.
>
> ## Two things to flag honestly
>
> 1. **`.github/FUNDING.yml` vanished.** It was present in the opening git-status snapshot and my first `find`, then disappeared from disk moments later (confirmed by `ls`, PowerShell, `find`, git) — I did **not** delete it, and I did not recreate/fabricate it. So the target tree's `.github/` is currently absent. If you want it back, restore your original file; I left it alone deliberately.
>
> 2. **Model-parser compatibility risk (unresolved, needs hardware).** The custom model is a **YOLOv8** export → single raw output tensor; the edge parser only decodes SSD-`_pp` (3-tensor) and NanoDet. **A successful `.rpk` build does not mean it runs.** This is documented in `docs/MODELS.md` (expected tensor formats, required metadata, post-processing, label ordering, and the physical-Pi test checklist) and `models/README.md`. Nothing in the repo claims hardware validation.
>
> **Remaining hardware-dependent checks:** load the custom `.rpk` on a real IMX500; inspect `get_outputs()` shapes + `network_intrinsics.postprocess`; confirm `rat`/`mouse` label mapping via `labels.txt`; verify person/bag/pest routing and end-to-end alerts (bag on the unattended path, rodent on the pest path); confirm a raw-YOLO decode branch is/ isn't needed.
>
> ## Suggested commit message
> ```
> Reorganise into edge/training/desktop; add pest detection
>
> Split the combined SecurePi + SecurePi2 tree into edge/ (Pi runtime),
> training/ (off-device dataset→train→export→compile), desktop/ (GUI), plus
> models/, deploy/, docs/, and shared tests/.
>
> - edge/securePi.py: add separate pest (rat/mouse) detection with its own
>   confidence, confirmation (duration or frames) and cooldown; rodents never
>   enter unattended-object/owner logic. Rename --bag-labels to
>   --unattended-object-labels (alias kept). Configurable runtime/ dir
>   (snapshots/logs/alerts, git-ignored) and richer events.csv; resolve
>   preset/model/label paths independent of CWD.
> - training/compile_imx500.py + run_pipeline.py: fail on missing converter,
>   bad return code, or missing/empty .rpk; never fake success; non-zero exit.
> - Split requirements into edge/training/desktop; expand .gitignore.
> - Merge docs into one root README; document the custom-model IMX500
>   parser-compatibility risk (unverified on hardware).
> - Fix docs bug that listed rat/mouse as bag labels.
> - Tests: add pest + compilation-failure coverage (31 pass, hardware mocked).
>
> Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
> ```
>
> I've stopped before committing so you can review everything.

**Outcome:** A final response was recorded in the source session.
