import React from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/Login.css'; 

const Login = () => {
  return (
    <div className="login-page-wrapper">
      <NavBar />
      <div className="login-content-area">
        <div className="login-container">
          <div className="login-box">
            <header className="login-header">
              <div className="login-logo-inline">
                 <div className="logo-icon"></div>
                 <span>FlowGuard</span>
              </div>
              <h1>Client Portal</h1>
              <p>Access the Harrison Food Factory IoT Dashboard</p>
            </header>

            <form className="login-form" onSubmit={(e) => e.preventDefault()}>
              <div className="input-group">
                <label>Authorized Email</label>
                <input type="email" placeholder="name@company.com" required />
              </div>

              <div className="input-group">
                <label>Access Key</label>
                <input type="password" placeholder="••••••••" required />
              </div>

              <button type="submit" className="login-submit-btn">
                Authenticate <span className="button-icon">→</span>
              </button>
            </form>

            <footer className="login-footer">
              <p>Protected by EchoSync AI Monitoring</p>
              <Link to="/contact">Request Access</Link>
            </footer>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Login;