import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/Booking.css';

const DriverPortal = () => {
  const navigate = useNavigate();
  const [selectedTime, setSelectedTime] = useState(null);

  const timeSlots = [
    "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM",
    "11:00 AM", "11:30 AM", "01:00 PM", "01:30 PM"
  ];

  const confirmSlot = () => {
    if (selectedTime) {
      // Navigate to the QR Pass page we built earlier!
      navigate('/driver-pass/LOG-9921'); 
    }
  };

  return (
    <div className="driver-mobile-layout">
      <div className="driver-mobile-container">
        <div className="mobile-header">
          <h2 className="gradient-text">FlowGuard</h2>
          <p>Harrison Food Factory</p>
        </div>

        <div className="instruction-box">
          <h3>Select Arrival Time</h3>
          <p>Please select your estimated time of arrival for Bay 2 (Cold Chain).</p>
        </div>

        <div className="time-slot-grid">
          {timeSlots.map((time) => (
            <button 
              key={time}
              className={`time-slot-btn ${selectedTime === time ? 'selected' : ''}`}
              onClick={() => setSelectedTime(time)}
            >
              {time}
            </button>
          ))}
        </div>

        <button 
          className="confirm-slot-btn" 
          disabled={!selectedTime}
          onClick={confirmSlot}
        >
          Confirm & Get Access Pass
        </button>
      </div>
    </div>
  );
};

export default DriverPortal;