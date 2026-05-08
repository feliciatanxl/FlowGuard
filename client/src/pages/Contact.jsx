import React from 'react';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import "../css/Contact.css";

const Contact = () => {
  return (
    <div className="contact-page-wrapper">
      <NavBar />
      
      <main className="contact-main">
        <div className="section-header">
          <h2 className="section-title">Connect with FlowGuard</h2>
          <p className="section-subtitle">Direct inquiries for the Harrison Food Factory deployment.</p>
        </div>

        <section className="contact-container">
          
          {/* Left Column: Info & Map */}
          <div className="contact-info">
            <h2>Project HQ</h2>
            
            <div className="map-wrapper">
              <iframe 
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3988.7350439627144!2d103.8845655!3d1.3351822000000002!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x31da178e1b4b80c1%3A0x89dfc581ef3fd6dc!2s7%20Harrison%20Rd%2C%20Singapore%20369650!5e0!3m2!1sen!2ssg!4v1714580000000!5m2!1sen!2ssg" 
                width="100%" 
                height="250" 
                style={{ 
                  border: 0, 
                  filter: 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)'
                }} 
                allowFullScreen="" 
                loading="lazy" 
                referrerPolicy="no-referrer-when-downgrade">
              </iframe>
            </div>

            <div className="info-item">
              <div className="info-icon">📍</div>
              <div className="info-text">
                <strong>Location</strong>
                <p>7 Harrison Rd, Singapore 369650</p>
              </div>
            </div>

            <div className="info-item">
              <div className="info-icon">📧</div>
              <div className="info-text">
                <strong>Inquiries</strong>
                <p>flowguard.support@gmail.com</p>
              </div>
            </div>
          </div>

          {/* Right Column: Form */}
          <form className="contact-form" onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" placeholder="Enter your full name" required />
            </div>

            <div className="form-group">
              <label>Work Email</label>
              <input type="email" placeholder="name@company.com" required />
            </div>

            <div className="form-group">
              <label>Inquiry Type</label>
              <select required>
                <option value="" disabled selected>Select Inquiry Type</option>
                <option value="technical">Technical Support</option>
                <option value="partnership">Partnership</option>
                <option value="media">Media Inquiry</option>
              </select>
            </div>

            <div className="form-group">
              <label>Your Message</label>
              <textarea placeholder="How can we help?" required></textarea>
            </div>

            <button type="submit" className="contact-submit-btn">
              Send Message <span className="button-icon">→</span>
            </button>
          </form>

        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Contact;