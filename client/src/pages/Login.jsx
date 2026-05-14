import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'; // 1. Import the hook
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import LogoIcon from '../components/LogoIcon';
import '../css/Login.css';
import '../css/DriverPass.css';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  // 2. Initialize the reCAPTCHA engine
  const { executeRecaptcha } = useGoogleReCaptcha();

  // 3. Make this function async so we can await the token
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);

    // 4. Safety check: Ensure reCAPTCHA is ready
    if (!executeRecaptcha) {
      setError("Security system is still loading. Please try again in a second.");
      return;
    }

    try {
      // 5. Generate the one-time token for this login attempt
      const token = await executeRecaptcha('login_submit');

      // 6. Pass the token in your Axios request
      const res = await axios.post('http://localhost:5000/user/login', { 
        email, 
        password,
        recaptchaToken: token // The "Key" your backend will check
      });

      // Existing logic
      localStorage.setItem("accessToken", res.data.token);
      localStorage.setItem("userRole", res.data.user.role);
      localStorage.setItem("userName", res.data.user.name);
      
      console.log(`Authenticated as ${res.data.user.role}. Welcome to FlowGuard.`);
      navigate('/dashboard');

    } catch (err) {
      // Handle both reCAPTCHA failures and wrong passwords
      setError(err.response?.data?.message || "Authentication failed");
    }
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

            <form className="login-form" onSubmit={handleLogin}>
              {error && <div className="error-message" style={{color: 'red', marginBottom: '10px'}}>{error}</div>}
              
              <div className="input-group">
                <label>Authorized Email</label>
                <input 
                  type="email" 
                  placeholder="name@company.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required 
                />
              </div>

              <div className="input-group">
                <label>Access Key</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                />
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