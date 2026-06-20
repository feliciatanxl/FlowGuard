import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/Booking.css';

const BAYS = ['Bay A', 'Bay B'];
const STATUS_FLOW = { Pending: 'Confirmed', Confirmed: 'Arrived', Arrived: 'Completed' };

const emptyForm = {
  transport_company: '', license_plate: '', driver_phone: '',
  driver_name: '', loading_bay: '', slot_start: '', slot_end: '', notes: ''
};

const TenantLogistics = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const token = localStorage.getItem('accessToken');
  const role = localStorage.getItem('userRole');
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  const canManage = role === 'FM' || role === 'Staff';   // status updates
  const canCreate = role === 'FM' || role === 'Tenant';  // create bookings

  const fetchBookings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/bookings/', authHeader);
      setBookings(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      setError('Could not load bookings. Please try again.');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBookings(); }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const onField = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const describeWhatsapp = (wa) => {
    if (!wa) return '';
    if (wa.simulated) return ' (WhatsApp simulated — disabled)';
    return wa.success ? ' (WhatsApp sent)' : ' (WhatsApp delivery pending)';
  };

  const createBooking = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await axios.post('/api/bookings/create', form, authHeader);
      setNotice('Booking created (status: Pending).');
      setForm(emptyForm);
      fetchBookings();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to create booking.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const res = await axios.patch(`/api/bookings/${id}/status`, { status }, authHeader);
      setNotice(`Booking ${status}.${describeWhatsapp(res.data?.whatsapp)}`);
      fetchBookings();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status.');
    }
  };

  const cancelBooking = async (id) => {
    try {
      const res = await axios.patch(`/api/bookings/${id}/cancel`, {}, authHeader);
      setNotice(`Booking cancelled.${describeWhatsapp(res.data?.whatsapp)}`);
      fetchBookings();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel booking.');
    }
  };

  const fmtSlot = (b) => {
    if (!b.slot_start) return '—';
    try { return new Date(b.slot_start).toLocaleString('en-SG', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return b.slot_start; }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Loading Bay Logistics</h1>
            <p>Smart queue management for the {BAYS.length} loading bays — book slots and avoid congestion</p>
          </div>
          <button className="edit-btn" onClick={fetchBookings}>Refresh</button>
        </header>

        {notice && <div className="toast-notification">{notice}</div>}
        {error && <div className="error-banner" style={{ margin: '0 0 16px' }}>⚠️ {error}</div>}

        <div className="booking-grid">
          {canCreate && (
            <div className="booking-card form-section">
              <h2>Schedule New Delivery</h2>
              <form onSubmit={createBooking} className="dark-form">
                <div className="form-group">
                  <label>Transport Company *</label>
                  <input name="transport_company" value={form.transport_company} onChange={onField} placeholder="e.g., NinjaVan" required />
                </div>
                <div className="form-group">
                  <label>Vehicle License Plate *</label>
                  <input name="license_plate" value={form.license_plate} onChange={onField} placeholder="e.g., GBG 1234M" required />
                </div>
                <div className="form-group">
                  <label>Driver Name</label>
                  <input name="driver_name" value={form.driver_name} onChange={onField} placeholder="e.g., Ahmad" />
                </div>
                <div className="form-group">
                  <label>Driver Phone *</label>
                  <input name="driver_phone" type="tel" value={form.driver_phone} onChange={onField} placeholder="+65..." required />
                </div>
                <div className="form-group">
                  <label>Loading Bay *</label>
                  <select name="loading_bay" value={form.loading_bay} onChange={onField} required>
                    <option value="">Select a bay...</option>
                    {BAYS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Slot Start</label>
                  <input name="slot_start" type="datetime-local" value={form.slot_start} onChange={onField} />
                </div>
                <div className="form-group">
                  <label>Slot End</label>
                  <input name="slot_end" type="datetime-local" value={form.slot_end} onChange={onField} />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <input name="notes" value={form.notes} onChange={onField} placeholder="Optional" />
                </div>
                <button type="submit" className="submit-booking-btn" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Booking'}
                </button>
              </form>
            </div>
          )}

          <div className="booking-card active-bookings" style={{ flex: 1 }}>
            <h2>{role === 'Tenant' ? 'My Bookings' : "Today's Bay Queue"}</h2>

            {loading ? (
              <p style={{ padding: '24px', color: '#94a3b8' }}>Loading bookings...</p>
            ) : bookings.length === 0 ? (
              <p style={{ padding: '24px', color: '#94a3b8' }}>No bookings scheduled yet.</p>
            ) : (
              <div className="table-container">
                <table className="management-table">
                  <thead>
                    <tr>
                      <th>Ref</th><th>Plate</th><th>Company</th><th>Bay</th>
                      <th>Slot</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => {
                      const nextStatus = STATUS_FLOW[b.status];
                      const isClosed = b.status === 'Completed' || b.status === 'Cancelled';
                      return (
                        <tr key={b.id}>
                          <td style={{ fontFamily: 'monospace' }}>{b.booking_ref}</td>
                          <td>{b.license_plate}</td>
                          <td>{b.transport_company}</td>
                          <td>{b.loading_bay}</td>
                          <td>{fmtSlot(b)}</td>
                          <td><span className={`status-badge ${String(b.status).toLowerCase()}`}>{b.status}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {canManage && nextStatus && (
                                <button className="edit-btn" onClick={() => updateStatus(b.id, nextStatus)}>
                                  Mark {nextStatus}
                                </button>
                              )}
                              {!isClosed && (role === 'FM' || role === 'Tenant') && (
                                <button className="edit-btn" style={{ background: '#7f1d1d' }} onClick={() => cancelBooking(b.id)}>
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default TenantLogistics;
