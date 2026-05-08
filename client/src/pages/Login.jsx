import React from 'react';
import { Link, useNavigate } from 'react-router-dom'; // 1. Added useNavigate
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/Login.css'; 
import LogoIcon from '../components/LogoIcon';

const Login = () => {
  const navigate = useNavigate(); // 2. Initialize the navigation hook

  // 3. This function handles the "fake" authentication
  const handleLogin = (e) => {
    e.preventDefault(); 
    
    // For now, we skip validation and go straight to the dashboard
    console.log("Authentication successful. Redirecting to Harrison Food Factory Dashboard...");
    navigate('/dashboard'); 
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
              <h1>Sign in to FlowGuard</h1>
              <p>Harrison Food Factory IoT Portal</p>
            </header>

            {/* 4. Link the form submission to our handleLogin function */}
            <form className="login-form" onSubmit={handleLogin}>
              <div className="input-group">
                <label>Authorized Email</label>
                <input type="email" placeholder="name@company.com" required />
              </div>

              <div className="input-group">
                <label>Access Key</label>
                <input type="password" placeholder="••••••••" required />
                
                <div className="forgot-link-wrapper">
                  <Link to="/forgot-password" className="forgot-link">Forgot Key?</Link>
                </div>
              </div>

              <button type="submit" className="login-submit-btn">
                Authenticate <span className="button-icon">→</span>
              </button>
            </form>

            <footer className="login-footer">
              <p className="security-badge">Protected by FlowGuard AI Monitoring</p>
              
              <div className="auth-links">
                <Link to="/register">New to FlowGuard?</Link>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Login;