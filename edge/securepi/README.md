# SecurePi sources and FlowGuard edge integration

This directory is the FlowGuard hub for the three SecurePi repositories supplied
as ZIP archives. Each archive is extracted under `repositories/` with its original
archive root intact, so the source, tests, documentation, licence, and model assets
remain easy to inspect. The ZIP binaries themselves are not duplicated in Git.

## Bundled repositories

| Repository | Local archive snapshot | Purpose |
|---|---|---|
| [feliciatanxl/SecurePi_FlowGuard](https://github.com/feliciatanxl/SecurePi_FlowGuard) | [`repositories/SecurePi_FlowGuard-main/`](repositories/SecurePi_FlowGuard-main/) | Recommended FlowGuard-integrated IMX500 edge runtime, FlowGuard API bridge, Camera Module 3 support, training tools, deployment templates, tests, and the supplied model artifact. |
| [feliciatanxl/SecurePi2](https://github.com/feliciatanxl/SecurePi2) | [`repositories/SecurePi2-master/`](repositories/SecurePi2-master/) | Desktop/training pipeline for dataset preparation, YOLO training, ONNX export, and IMX500 compilation. |
| [feliciatanxl/SecurePi](https://github.com/feliciatanxl/SecurePi) | [`repositories/SecurePi-main/`](repositories/SecurePi-main/) | Original Raspberry Pi AI Camera unattended-bag runtime and presets. |

The local directories are archive snapshots, not Git submodules. Visit the linked
GitHub repositories for their current history, issues, and newer releases. See
[`repositories/README.md`](repositories/README.md) for archive hashes and provenance.

## Which source should I use?

- Use **SecurePi_FlowGuard** for new FlowGuard deployments. It contains the edge
  runtime and the non-blocking authenticated bridge to FlowGuard's
  `POST /api/edge/detection-alerts` endpoint.
- Use **SecurePi2** on a desktop, workstation, or suitable build environment when
  preparing datasets, training the six-class model, exporting ONNX, or compiling
  an IMX500 `.rpk` model.
- Use **SecurePi** when you need the original, smaller unattended-bag IMX500
  implementation or want to compare the upstream baseline.

Each repository has its own detailed README:

- [SecurePi_FlowGuard setup and architecture](repositories/SecurePi_FlowGuard-main/README.md)
- [SecurePi2 training pipeline](repositories/SecurePi2-master/README.md)
- [SecurePi original runtime](repositories/SecurePi-main/README.md)

## FlowGuard-integrated quick start

The integrated runtime is intended for Raspberry Pi OS Bookworm with a Raspberry
Pi AI Camera (IMX500). Install the camera stack on the Pi as documented in the
bundled SecurePi_FlowGuard README, then configure its environment without
committing real tokens:

```env
FLOWGUARD_EDGE_ENABLED=true
FLOWGUARD_API_URL=http://<flowguard-server-ip>:5001
EDGE_INGEST_TOKEN=<same-value-as-the-FlowGuard-backend>
SECUREPI_DEVICE_ID=securepi-loading-bay-01
SECUREPI_CAMERA_LOCATION=Loading Bay Camera 01
```

Run the integrated source from its repository root:

```bash
cd edge/securepi/repositories/SecurePi_FlowGuard-main
python3 edge/securePi.py @edge/presets/lobby.args --headless --flowguard-enabled
```

For a managed Pi deployment, use the repository's maintained templates:

- `repositories/SecurePi_FlowGuard-main/deploy/securepi.service`
- `repositories/SecurePi_FlowGuard-main/deploy/securepi.env.example`

The Pi sends only authenticated event data to FlowGuard. It does not call
WhatsApp directly; the Node backend owns notification policy and credentials.

## FlowGuard compatibility bridge

The files at this directory's top level (`securepi_edge.py`, `.env.example`,
`lobby.args`, and `test_securepi_edge.py`) are retained as the earlier
hardware-tolerant FlowGuard bridge/demo. The `upstream/` directory is a runnable
historical all-in-one SecurePi snapshot retained for compatibility and regression
coverage; its implementation and 25-test suite were restored as the matching pair
from repository history. It is not the authoritative deployment source. New
FlowGuard deployments should use the complete
`repositories/SecurePi_FlowGuard-main/` runtime and its maintained deployment
templates. Do not run the historical and recommended runtimes simultaneously on
the same camera.

Run the compatibility tests from the FlowGuard repository root:

```bash
python -m pytest edge/securepi/test_securepi_edge.py
```

Run the bundled source tests from their respective repository roots:

```bash
cd edge/securepi/repositories/SecurePi_FlowGuard-main
python -m pytest edge/tests tests

cd ../SecurePi-main
python -m pytest tests

cd ../../upstream
python -m pytest tests
```

## Security and hardware notes

- Keep `EDGE_INGEST_TOKEN` out of Git and match it with the FlowGuard backend.
- Do not expose a Pi camera stream publicly without authentication and TLS.
- Keep the Pi and the local FlowGuard demo client on a trusted network.
- Model training and IMX500 compilation happen off-device; copy only the required
  compiled model and labels to the Pi.
- The supplied projects contain off-device tests, but physical IMX500 behaviour
  still requires validation on the target Raspberry Pi and camera.
