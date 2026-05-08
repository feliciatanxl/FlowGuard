import React from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/Login.css';
import LogoIcon from '../components/LogoIcon';

const Register = () => {
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
              <h1>Request Access</h1>
              <p>Register for authorization to the IoT Dashboard.</p>
            </header>

            <form className="login-form" onSubmit={(e) => e.preventDefault()}>
              <div className="input-group">
                <label>Full Name</label>
                <input type="text" placeholder="Enter your full name" required />
              </div>

              <div className="input-group">
                <label>Authorized Email</label>
                <input type="email" placeholder="name@company.com" required />
              </div>

              <div className="input-group">
                <label>Create Access Key</label>
                <input type="password" placeholder="Minimum 8 characters" required minLength="8" />
              </div>

              <button type="submit" className="login-submit-btn">
                Submit Request <span className="button-icon"></span>
              </button>
            </form>

            <footer className="login-footer">
              <p className="security-badge">Subject to FlowGuard Administrator Approval</p>
              
              <div className="auth-links">
                <Link to="/login">Already authorized?</Link>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Register;