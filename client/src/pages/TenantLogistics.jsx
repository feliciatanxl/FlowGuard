import React, { useState } from 'react';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Booking.css';

const TenantLogistics = () => {
  const [plate, setPlate] = useState('');
  const [company, setCompany] = useState('');
  
  const handleBooking = (e) => {
    e.preventDefault();
    alert(`Booking created for ${plate}! A link has been sent to the driver.`);
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Logistics & Bay Booking</h1>
            <p>Schedule incoming deliveries and manage loading bay access</p>
          </div>
        </header>

        <div className="booking-grid">
          {/* Left Side: Booking Form */}
          <div className="booking-card form-section">
            <h2>Schedule New Delivery</h2>
            <form onSubmit={handleBooking} className="dark-form">
              <div className="form-group">
                <label>Transport Company</label>
                <input 
                  type="text" 
                  placeholder="e.g., NinjaVan, DHL, Independent" 
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required 
                />
              </div>
              
              <div className="form-group">
                <label>Vehicle License Plate</label>
                <input 
                  type="text" 
                  placeholder="e.g., GBG 1234M" 
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  required 
                />
              </div>

              <div className="form-group">
                <label>Assign Loading Bay</label>
                <select required>
                  <option value="">Select a Sector...</option>
                  <option value="1">Sector 1 - Heavy Freight</option>
                  <option value="2">Sector 2 - Cold Chain</option>
                  <option value="3">Sector 3 - Standard Goods</option>
                </select>
              </div>

              <button type="submit" className="submit-booking-btn">Generate Driver Invite Link</button>
            </form>
          </div>

          {/* Right Side: Active Bookings */}
          <div className="booking-card active-bookings">
            <h2>Today's Expected Arrivals</h2>
            <div className="arrival-list">
              <div className="arrival-item">
                <div className="arrival-info">
                  <strong>XJ 9921 K</strong>
                  <span>Cold Chain Logistics • Bay 2</span>
                </div>
                <span className="time-badge">10:30 AM</span>
              </div>
              <div className="arrival-item">
                <div className="arrival-info">
                  <strong>SGA 4412 P</strong>
                  <span>Independent • Bay 1</span>
                </div>
                <span className="time-badge warning">Delayed</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TenantLogistics;