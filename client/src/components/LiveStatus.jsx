import React, { useState, useEffect } from 'react';

const LiveStatus = () => {
  // Simulated sensor states
  const [temp, setTemp] = useState(4.2);
  const [humidity, setHumidity] = useState(55);
  const [occupancy, setOccupancy] = useState(1);

  useEffect(() => {
    // Simulate data flux every 3 seconds
    const interval = setInterval(() => {
      setTemp(prev => +(prev + (Math.random() * 0.4 - 0.2)).toFixed(1));
      setHumidity(prev => Math.floor(prev + (Math.random() * 2 - 1)));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const sensorData = [
    { label: "Cold Room Temp", value: `${temp}°C`, status: temp > 5 ? "Warning" : "Optimal" },
    { label: "Humidity Level", value: `${humidity}%`, status: "Stable" },
    { label: "Loading Bay 01", value: occupancy === 1 ? "Occupied" : "Vacant", status: "Active" },
    { label: "AI PPE Scanner", value: "99.8%", status: "Active" }
  ];

  return (
    <section className="live-status-section">
      <div className="status-header">
        <h2 className="status-title">Live Facility Telemetry</h2>
        <div className="live-indicator">
          <div className="pulse-dot"></div>
          REAL-TIME FEED
        </div>
      </div>

      <div className="status-grid">
        {sensorData.map((sensor, i) => (
          <div key={i} className="sensor-card">
            <span className="sensor-label">{sensor.label}</span>
            <div className="sensor-value">{sensor.value}</div>
            <span className={`sensor-tag ${sensor.status.toLowerCase()}`}>
              {sensor.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default LiveStatus;