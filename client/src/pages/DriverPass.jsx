import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import * as QRLib from "react-qr-code";
import "../css/DriverPass.css";
import { API_BASE_URL } from "../constants/api";
import { formatSingaporeBookingDateTime } from "../constants/datetime";

// Background refresh cadence while the pass stays open (ms).
const REFRESH_INTERVAL_MS = 12000;

// Resolve the QR component across CJS/ESM interop shapes. Under Vite/React 19 the
// CommonJS module can be wrapped so `QRLib.default` is the module object (an object,
// not the component) — that "object" is exactly what crashes the render.
const QRCodeComponent =
    QRLib.default?.default ||
    QRLib.default ||
    QRLib.QRCode ||
    QRLib.QRCodeSVG;

// A valid React element type is a function OR an object with $$typeof (forwardRef/memo).
const canRenderQr =
    typeof QRCodeComponent === "function" ||
    (typeof QRCodeComponent === "object" && QRCodeComponent !== null && Boolean(QRCodeComponent.$$typeof));

if (import.meta.env?.DEV) {
    // One-time dev diagnostic (safe to remove later).
    console.log("[DriverPass] QR export type:", typeof QRCodeComponent, "canRender:", canRenderQr);
}

// Slot times always render in Singapore time, regardless of the driver's phone
// timezone (the stored value is an absolute UTC instant).
const fmt = (v) => formatSingaporeBookingDateTime(v);

const DriverPass = () => {
    const { ref } = useParams(); // booking_ref from /driver-pass/:ref
    const [booking, setBooking] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [copied, setCopied] = useState(false);

    // Refs coordinate the background refresh without re-rendering:
    //   alive     — block state updates after unmount
    //   inFlight  — prevent overlapping requests
    //   stopped   — stop polling for good once the pass is permanently gone (404)
    const aliveRef = useRef(true);
    const inFlightRef = useRef(false);
    const stoppedRef = useRef(false);

    // Tag the body so global floating widgets (reCAPTCHA badge) can be hidden on the pass.
    useEffect(() => {
        document.body.classList.add("driver-pass-page");
        return () => document.body.classList.remove("driver-pass-page");
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        stoppedRef.current = false;

        // Guard: don't call /api/bookings/ with an empty ref.
        if (!ref) { setNotFound(true); setLoading(false); return; }

        // A single reusable loader. `background` refreshes never show the
        // full-page loader and never wipe a good pass on a transient failure —
        // that keeps the QR steady and avoids flicker while polling.
        const load = async ({ background = false } = {}) => {
            if (stoppedRef.current || inFlightRef.current) return;
            inFlightRef.current = true;
            try {
                // cache: "no-store" so an already-open pass always sees the latest
                // status/slot after an FM edits or cancels the booking.
                const res = await fetch(
                    `${API_BASE_URL}/api/bookings/${encodeURIComponent(ref)}`,
                    { cache: "no-store" }
                );
                const payload = await res.json().catch(() => null);
                // Support both shapes: a direct booking object OR a { booking } envelope.
                const loaded = payload && (payload.booking || payload);
                if (!aliveRef.current) return;

                if (res.status === 404) {
                    stoppedRef.current = true;   // gone for good — stop polling
                    setNotFound(true);
                } else if (!res.ok || !loaded || !(loaded.booking_ref || loaded.reference)) {
                    if (!background) setNotFound(true); // keep last-good data on a background blip
                } else {
                    setBooking(loaded);
                    setNotFound(false);
                }
            } catch (err) {
                if (!aliveRef.current) return;
                if (!background) {
                    console.error("Error fetching pass:", err);
                    setNotFound(true);
                }
            } finally {
                inFlightRef.current = false;
                if (!background && aliveRef.current) setLoading(false);
            }
        };

        // Initial load (foreground), then keep the open pass live.
        load({ background: false });

        const refresh = () => load({ background: true });
        const onFocus = () => refresh();
        const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        const interval = setInterval(() => {
            if (document.visibilityState !== "hidden") refresh();
        }, REFRESH_INTERVAL_MS);

        return () => {
            aliveRef.current = false;
            clearInterval(interval);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [ref]);

    // Copy the link to THIS pass using whatever host the browser is on:
    //   localhost → localhost link, 172.x LAN → LAN link, Cloud Run → HTTPS link.
    // No host is ever hardcoded here.
    const copyPassLink = async () => {
        const url = window.location.origin + window.location.pathname;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                // Fallback for insecure/older contexts without the async clipboard API.
                const ta = document.createElement("textarea");
                ta.value = url;
                ta.setAttribute("readonly", "");
                ta.style.position = "absolute";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    if (loading) return <div className="driver-container"><div className="loader">Loading your pass…</div></div>;
    if (notFound || !booking) return <div className="driver-container"><div className="pass-card"><div className="error">Pass not found or expired.</div></div></div>;

    // Support booking_ref / reference / route-param; QR must always get a non-empty string.
    const bookingRef = booking.booking_ref || booking.reference || ref || "";
    const qrValue = String(bookingRef || "");
    const status = booking.status || "Pending";
    const inactive = status === "Cancelled" || status === "Completed";
    const statusColor = status === "Cancelled" ? "#f43f5e"
        : status === "Completed" ? "#64748b"
        : status === "Arrived" ? "#f59e0b"
        : status === "Confirmed" ? "#10b981"
        : "#3b82f6";

    return (
        <div className="driver-container">
            <div className="pass-card">
                <header className="pass-header">
                    <h1 className="pass-brand">FlowGuard</h1>
                    <p className="pass-org">Harrison Food Factory</p>
                    <span className="badge">Driver Entry Pass</span>
                </header>

                {inactive && (
                    <div style={{
                        background: "rgba(244,63,94,0.12)", border: `1px solid ${statusColor}`,
                        color: statusColor, borderRadius: 10, padding: "10px 12px", margin: "12px 0",
                        textAlign: "center", fontWeight: 600
                    }}>
                        {status === "Cancelled"
                            ? "⚠ This booking has been CANCELLED. Entry is not authorised."
                            : "This booking is COMPLETED. The loading session has ended."}
                    </div>
                )}

                <div className="qr-section">
                    {canRenderQr && qrValue
                        ? <QRCodeComponent value={qrValue} size={180} />
                        : <div className="qr-fallback" style={{ color: "#94a3b8", fontSize: "0.9rem", textAlign: "center", padding: "8px 0" }}>
                            QR unavailable — use booking reference at gate
                          </div>}
                    <p className="ref-text">{bookingRef || "—"}</p>
                    <span style={{
                        display: "inline-block", marginTop: 8, padding: "4px 12px", borderRadius: 999,
                        background: `${statusColor}22`, color: statusColor, fontWeight: 700, fontSize: "0.8rem"
                    }}>
                        {status}
                    </span>
                </div>

                <div className="info-grid">
                    <div className="info-item">
                        <label>Driver</label>
                        <p>{booking.driver_name || "—"}</p>
                    </div>
                    <div className="info-item">
                        <label>License Plate</label>
                        <p>{booking.license_plate}</p>
                    </div>
                    <div className="info-item">
                        <label>Loading Bay</label>
                        <p className="bay-highlight">{booking.loading_bay}</p>
                    </div>
                    <div className="info-item">
                        <label>Transport Co.</label>
                        <p>{booking.transport_company}</p>
                    </div>
                    <div className="info-item">
                        <label>Slot Start</label>
                        <p>{fmt(booking.slot_start)}</p>
                    </div>
                    <div className="info-item">
                        <label>Slot End</label>
                        <p>{fmt(booking.slot_end)}</p>
                    </div>
                </div>

                <button
                    type="button"
                    className="copy-pass-btn"
                    onClick={copyPassLink}
                    aria-label="Copy driver pass link"
                >
                    {copied ? "✓ Link copied" : "🔗 Copy Driver Pass Link"}
                </button>

                <footer>
                    <p>Show this QR code at the loading bay gate. Please do not arrive before your slot.</p>
                </footer>
            </div>
        </div>
    );
};

export default DriverPass;
