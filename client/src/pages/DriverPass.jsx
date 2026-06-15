import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "react-qr-code"; // Ensure you installed this!

const DriverPass = () => {
    const { ref } = useParams(); // Gets the 'FG-XXXX' from the URL
    const [booking, setBooking] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fetch the booking details using the reference
        const fetchBooking = async () => {
            try {
                const response = await fetch(`/api/bookings/${ref}`);
                const data = await response.json();
                setBooking(data);
                setLoading(false);
            } catch (err) {
                console.error("Error fetching pass:", err);
                setLoading(false);
            }
        };

        fetchBooking();
    }, [ref]);

    if (loading) return <div className="loader">Loading your pass...</div>;
    if (!booking) return <div className="error">Pass not found or expired.</div>;

    return (
        <div className="driver-container">
            <div className="pass-card">
                <header>
                    <h1>Harrison Food Factory</h1>
                    <span className="badge">Entry Pass</span>
                </header>

                <div className="qr-section">
                    {/* The QR code contains the booking reference for security to scan */}
                    <QRCode value={booking.booking_ref} size={180} />
                    <p className="ref-text">{booking.booking_ref}</p>
                </div>

                <div className="info-grid">
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
                </div>

                <footer>
                    <p>Please show this QR code at the security gate.</p>
                </footer>
            </div>
        </div>
    );
};

export default DriverPass;