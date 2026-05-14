import React, { useState, useEffect } from 'react'; // Added useEffect
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Booking.css';

const TenantLogistics = () => {
  const [plate, setPlate] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [bay, setBay] = useState(''); // State for the dropdown
  const [bookings, setBookings] = useState([]); // State for the list

  // Fetch bookings on load
  const fetchBookings = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/bookings/all');
      const data = await response.json();
      setBookings(data);
    } catch (err) {
      console.error("Failed to fetch bookings:", err);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleBooking = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5000/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transport_company: company,
          license_plate: plate,
          driver_phone: phone,
          loading_bay: bay // Use the state variable here
        })
      });

      const data = await response.json();
      if (data.success) {
        alert("Success! Link sent to driver.");
        fetchBookings(); // Refresh the list after booking
        // Clear form
        setPlate(''); setCompany(''); setPhone(''); setBay('');
      }
    } catch (err) {
      console.error("Failed to book:", err);
    }
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
          <div className="booking-card form-section">
            <h2>Schedule New Delivery</h2>
            <form onSubmit={handleBooking} className="dark-form">
              <div className="form-group">
                <label>Transport Company</label>
                <input type="text" placeholder="e.g., NinjaVan" value={company} onChange={(e) => setCompany(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Vehicle License Plate</label>
                <input type="text" placeholder="e.g., GBG 1234M" value={plate} onChange={(e) => setPlate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Driver Phone Number</label>
                <input type="tel" placeholder="+65..." value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Assign Loading Bay</label>
                <select value={bay} onChange={(e) => setBay(e.target.value)} required>
                  <option value="">Select a Sector...</option>
                  <option value="Bay 1">Sector 1 - Heavy Freight</option>
                  <option value="Bay 2">Sector 2 - Cold Chain</option>
                  <option value="Bay 3">Sector 3 - Standard Goods</option>
                </select>
              </div>
              <button type="submit" className="submit-booking-btn">Generate Driver Invite Link</button>
            </form>
          </div>

          <div className="booking-card active-bookings">
            <h2>Today's Expected Arrivals</h2>
            <div className="arrival-list">
              {bookings.length > 0 ? bookings.map((b) => (
                <div className="arrival-item" key={b.id}>
                  <div className="arrival-info">
                    <strong>{b.license_plate}</strong>
                    <span>{b.transport_company} • {b.loading_bay}</span>
                  </div>
                  <span className={`status-badge ${b.status.toLowerCase()}`}>{b.status}</span>
                </div>
              )) : <p>No arrivals scheduled yet.</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TenantLogistics;