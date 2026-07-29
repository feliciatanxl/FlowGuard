import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { buildAnalyzeFramePayload, buildBearerHeaders } from '../utils/analyzeFrame';
import '../css/CameraFeed.css';

const HARDWARE_STREAM_PATTERN = /video_feed|mjpeg|mjpg/i;
const MIN_DISPLAY_CONFIDENCE = 0.18;

export function isHardwareStream(video) {
  if (typeof video !== 'string' || !/^https?:\/\//i.test(video)) return false;
  return HARDWARE_STREAM_PATTERN.test(video);
}

const detectionColor = (det) => {
  if (det.status === 'suspicious') return '#f43f5e';
  if (det.status === 'authorized') return '#22c55e';
  if (det.type === 'person') return '#22c55e';
  if (det.type === 'food_item') return '#facc15';
  if (det.type === 'vehicle') return '#38bdf8';
  return '#f59e0b';
};

export default function CameraFeed({ cam }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processingRef = useRef(false);
  const isHardware = isHardwareStream(cam.video);
  const [hardwareStatus, setHardwareStatus] = useState('loading');

  useEffect(() => {
    if (isHardware) return undefined;

    let cancelled = false;
    let activeController = null;

    const analyzeFrame = async () => {
      if (processingRef.current || cancelled) return;

      const headers = buildBearerHeaders(localStorage.getItem('accessToken'));
      if (!headers) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      processingRef.current = true;

      try {
        const captureCanvas = document.createElement('canvas');
        const maxWidth = 1280;
        const scale = Math.min(1, maxWidth / video.videoWidth);

        captureCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        captureCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));

        const captureCtx = captureCanvas.getContext('2d');
        captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

        // Higher quality than the old 0.35/low-resolution path so smaller
        // objects such as chairs, monitors, bottles and laptops survive JPEG
        // compression and remain visible to YOLO.
        const image = captureCanvas.toDataURL('image/jpeg', 0.72);

        const payload = buildAnalyzeFramePayload(image, cam, 'Uploaded Video');
        const controller = new AbortController();
        activeController = controller;

        const response = await axios.post('/api/yolo/analyze-frame', payload, {
          timeout: 20000,
          headers,
          signal: controller.signal,
        });

        if (!cancelled) drawDetections(response.data);
      } catch (err) {
        if (!cancelled) {
          console.error(`${cam.code || cam.id} detection error`, err);
        }
      } finally {
        activeController = null;
        processingRef.current = false;
      }
    };

    const handleReady = () => {
      analyzeFrame();
    };

    const video = videoRef.current;
    video?.addEventListener('loadeddata', handleReady);

    analyzeFrame();
    const interval = setInterval(analyzeFrame, 1800);

    return () => {
      cancelled = true;
      clearInterval(interval);
      video?.removeEventListener('loadeddata', handleReady);
      activeController?.abort();
      activeController = null;
      processingRef.current = false;
    };
  }, [isHardware, cam.video, cam.databaseId, cam.zoneId]);

  useEffect(() => {
    if (isHardware) setHardwareStatus('loading');
  }, [isHardware, cam.video]);

  const drawDetections = (data) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frameWidth = Number(data?.frame_width) || video.videoWidth;
    const frameHeight = Number(data?.frame_height) || video.videoHeight;
    if (!frameWidth || !frameHeight) return;

    const videoRatio = frameWidth / frameHeight;
    const canvasRatio = canvas.width / canvas.height;

    let renderWidth;
    let renderHeight;
    let offsetX = 0;
    let offsetY = 0;

    // CameraFeed.css uses object-fit: contain. Mirror the same letterbox maths
    // so every returned box lines up with the visible frame.
    if (canvasRatio > videoRatio) {
      renderHeight = canvas.height;
      renderWidth = canvas.height * videoRatio;
      offsetX = (canvas.width - renderWidth) / 2;
    } else {
      renderWidth = canvas.width;
      renderHeight = canvas.width / videoRatio;
      offsetY = (canvas.height - renderHeight) / 2;
    }

    const scaleX = renderWidth / frameWidth;
    const scaleY = renderHeight / frameHeight;
    const detections = Array.isArray(data?.detections) ? data.detections : [];

    // The AI service has already applied its model threshold. The old client
    // applied a second restrictive allow-list and >= 0.50 filter, which hid
    // chairs, TVs/monitors, keyboards, mice and many valid lower-confidence
    // objects. Keep only malformed/very weak detections here.
    detections
      .filter((det) => (
        Array.isArray(det?.box)
        && det.box.length === 4
        && Number(det.confidence ?? 0) >= MIN_DISPLAY_CONFIDENCE
      ))
      .slice(0, 30)
      .forEach((det) => {
        const [x1, y1, x2, y2] = det.box.map(Number);
        const color = detectionColor(det);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          offsetX + x1 * scaleX,
          offsetY + y1 * scaleY,
          (x2 - x1) * scaleX,
          (y2 - y1) * scaleY
        );

        const label = String(det.label || det.type || 'Object');
        const labelX = offsetX + x1 * scaleX;
        const labelY = Math.max(16, offsetY + y1 * scaleY - 6);

        ctx.font = 'bold 12px Arial';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(labelX - 2, labelY - 13, textWidth + 8, 17);
        ctx.fillStyle = '#05070d';
        ctx.fillText(label, labelX + 2, labelY);
      });
  };

  const displayCode = cam.code || cam.id;

  if (isHardware) {
    return (
      <div className="camera-feed-placeholder">
        <img
          src={cam.video}
          alt={`${displayCode} live stream`}
          className="camera-video"
          onLoad={() => setHardwareStatus('live')}
          onError={() => setHardwareStatus('error')}
        />

        <div className="camera-feed-hud">
          <span>{displayCode}</span>
        </div>

        {hardwareStatus === 'error' && (
          <div className="camera-feed-error">SecurePi feed unavailable</div>
        )}
      </div>
    );
  }

  return (
    <div className="camera-feed-placeholder">
      <video
        ref={videoRef}
        src={cam.video}
        autoPlay
        muted
        loop
        playsInline
        className="camera-video"
      />

      <div className="camera-feed-hud">
        <span>{new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
        <span>{displayCode}</span>
      </div>

      <canvas ref={canvasRef} className="camera-overlay" />
    </div>
  );
}
