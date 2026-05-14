import React from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'react-qr-code'; 

const DriverPass = () => {
  const { bookingId } = useParams();

  return (
    <div className="driver-pass-container">
      <div className="pass-card">
        <h2>Harrison Food Factory</h2>
        <p className="pass-sub">Logistics Access Pass</p>
        
        <div className="qr-wrapper">
          <QRCode value={`PASS-${bookingId}`} size={200} bgColor="#ffffff" fgColor="#0f172a" />
        </div>
        
        <div className="pass-details">
          <div className="detail">
            <span>Booking ID:</span>
            <strong>#{bookingId}</strong>
          </div>
          <div className="detail">
            <span>Status:</span>
            <strong className="status-ready">READY FOR ENTRY</strong>
          </div>
        </div>
      </div>
    </div>
  );
};