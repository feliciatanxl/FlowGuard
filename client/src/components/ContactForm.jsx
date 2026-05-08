import React, { useState } from 'react';

const ContactForm = () => {
  const [formData, setFormData] = useState({ name: '', email: '', message: '', type: 'General' });

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Inquiry Received:", formData);
    alert("Inquiry sent to FlowGuard Systems.");
  };

  return (
    <section className="contact-section">
      <div className="contact-container">
        <div className="contact-info">
          <h2>Get in Touch</h2>
          <p>Inquire about AI implementation for the 2027 factory launch.</p>
          <div className="contact-detail"><strong>Location:</strong> 7 Harrison Rd, Singapore 369650</div>
          <div className="contact-detail"><strong>Status:</strong> Opening Soon In 2027</div>
        </div>

        <form className="contact-form" onSubmit={handleSubmit}>
          <input 
            type="text" 
            placeholder="Your Name" 
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required 
          />
          <input 
            type="email" 
            placeholder="Work Email" 
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            required 
          />
          <select onChange={(e) => setFormData({...formData, type: e.target.value})}>
            <option value="General">General Inquiry</option>
            <option value="IoT">IoT & Sensors</option>
            <option value="Compliance">Compliance & Security</option>
          </select>
          <textarea 
            placeholder="How can FlowGuard assist your operations?" 
            onChange={(e) => setFormData({...formData, message: e.target.value})}
            required
          ></textarea>
          <button type="submit" className="hero-button">Send Inquiry</button>
        </form>
      </div>
    </section>
  );
};

export default ContactForm;