import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/Login.css';
import LogoIcon from '../components/LogoIcon';

const ForgotKey = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  return (
    <div className="login-page-wrapper">
      <NavBar />
      
      <div className="login-content-area">
        <div className="login-container">
          <div className="login-box">
            <header className="login-header">
              <div className="login-logo-centered">
                <LogoIcon size={48} /> 
              </div>
              <h1>Key Recovery</h1>
              <p>Secure access reset for the Harrison Food Factory.</p>
            </header>

            {!isSubmitted ? (
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="input-group">
                  <label>Authorized Email</label>
                  <input type="email" placeholder="name@company.com" required />
                </div>

                <button type="submit" className="login-submit-btn">
                  Send Recovery Link <span className="button-icon"></span>
                </button>
              </form>
            ) : (
              <div className="success-state">
                <div className="success-icon">✓</div>
                <h3>Transmission Sent</h3>
                <p className="success-text">
                  If that email matches an authorized FlowGuard profile, you will receive a secure recovery link shortly.
                </p>
              </div>
            )}

            <footer className="login-footer">
              <div className="auth-links">
                <Link to="/login" className="back-to-login">
                  Back to Client Portal Login
                </Link>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default ForgotKey;