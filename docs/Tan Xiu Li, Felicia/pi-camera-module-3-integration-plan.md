# Raspberry Pi Camera Module 3 deployment integration

## Architecture

The FlowGuard JavaScript running in the laptop's browser connects directly to the
Raspberry Pi over the shared phone hotspot. Cloud Run serves the frontend and handles
the existing API requests, but it does not connect to the Pi's private address and is
not a Pi proxy.

The Pi Camera Module 3 is preferred when it is enabled, configured, and healthy. The
laptop webcam remains the automatic fallback. Upload, manual, and simulation modes are
unchanged.

## Pi camera server

`raspberry-pi/pi_camera_steam.py` binds to `0.0.0.0:8081` and provides:

| Purpose | Endpoint |
|---|---|
| Health check | `http://<PI-IP>:8081/health` |
| Live MJPEG preview | `http://<PI-IP>:8081/video_feed` |
| Single JPEG snapshot | `http://<PI-IP>:8081/snapshot` |

The server has one background `CaptureLoop` as the only Picamera2 owner. It configures
the Camera Module 3 for 640x480 RGB888, encodes each captured frame once, and retains
only the latest JPEG in memory. It does not write frames to disk.

Browser access is restricted to `FLOWGUARD_FRONTEND_ORIGIN`, which defaults to the
deployed staging frontend. The server answers GET and OPTIONS with no-store headers,
exact-origin CORS, and approved Chrome private-network preflights. Override the origin
only when serving FlowGuard from another trusted origin:

```bash
export FLOWGUARD_FRONTEND_ORIGIN=https://flowguard-client-staging-590663319889.asia-southeast1.run.app
python3 pi_camera_steam.py
```

## Runtime browser configuration

Settings -> Raspberry Pi Camera stores only the normalized base URL in
`localStorage` under `flowguard.piCameraBaseUrl`. It never stores a frame, snapshot,
credential, token, or recognition result. Saving `http://<PI-IP>:8081/` normalizes it
to `http://<PI-IP>:8081` and derives `/health`, `/video_feed`, and `/snapshot`.

Resolution order is:

1. valid runtime browser URL;
2. valid `VITE_PI_CAMERA_*` endpoint configuration;
3. unconfigured, with immediate webcam fallback.

`VITE_ENABLE_PI_CAMERA=false` disables all Pi probing and Pi stream/snapshot use.
Runtime Settings is preferred because a hotspot can assign a new Pi address without a
frontend rebuild. Optional build-time public values are:

```bash
VITE_ENABLE_PI_CAMERA=true
VITE_PI_CAMERA_HEALTH_URL=http://<PI-IP>:8081/health
VITE_PI_CAMERA_STREAM_URL=http://<PI-IP>:8081/video_feed
VITE_PI_CAMERA_SNAPSHOT_URL=http://<PI-IP>:8081/snapshot
```

Do not put secrets in Vite variables: every `VITE_` value is public browser code.

## Demo procedure

1. Turn on phone hotspot.
2. Connect the Raspberry Pi and laptop to the same hotspot.
3. On the Pi, run:

   ```bash
   hostname -I
   ```

4. Start the Pi server.
5. On the laptop, test:

   ```text
   http://<PI-IP>:8081/health
   http://<PI-IP>:8081/snapshot
   http://<PI-IP>:8081/video_feed
   ```

6. Open the deployed FlowGuard frontend.
7. Go to Settings -> Raspberry Pi Camera.
8. Enter:

   ```text
   http://<PI-IP>:8081
   ```

9. Click Test Connection.
10. Allow Chrome local-network access when prompted.
11. Open Gate Scanner or Gate Verification.
12. Confirm Pi Camera is selected.
13. Confirm webcam fallback works when the Pi stops.

Chrome behavior and error text can vary by version and platform. A likely browser
security failure is shown as Permission Required; an offline Pi is shown as
Unreachable. If the hotspot changes the Pi IP, repeat `hostname -I` and update the
runtime URL in Settings.

## Pi installation and start commands

Copy or pull these current repository files onto the Pi:

- `raspberry-pi/pi_camera_steam.py`

Then run:

```bash
sudo apt update
sudo apt install -y python3-picamera2 python3-opencv python3-flask
cd /path/to/FlowGuard/raspberry-pi
python3 pi_camera_steam.py
```

From another hotspot-connected machine, replace `<PI-IP>` and test:

```bash
curl -i http://<PI-IP>:8081/health
curl -o snapshot.jpg http://<PI-IP>:8081/snapshot
curl -i --max-time 3 http://<PI-IP>:8081/video_feed
```

## Network and privacy boundary

The camera endpoints are unauthenticated and are appropriate only on a trusted demo
network. Do not forward port 8081 from the hotspot/router or otherwise expose it to the
public internet. Raw snapshots are transient in browser memory and continue through
the existing authenticated FlowGuard recognition/QR paths; the Pi configuration itself
contains no secret.
