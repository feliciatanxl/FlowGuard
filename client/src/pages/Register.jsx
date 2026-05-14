import React, { useState } from 'react'; 
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios'; 
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'; // 1. Import the hook
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import LogoIcon from '../components/LogoIcon';
import '../css/Login.css';

const Register = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Tenant'); 
  const [error, setError] = useState(null);

  // 2. Initialize the reCAPTCHA engine
  const { executeRecaptcha } = useGoogleReCaptcha();

  // 3. Make the function async
  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);

    // 4. Safety check: Ensure reCAPTCHA is ready
    if (!executeRecaptcha) {
      setError("Security system is still loading. Please try again.");
      return;
    }

    try {
      // 5. Generate the token for this specific registration attempt
      const token = await executeRecaptcha('register_submit');

      // 6. Include the token in your payload
      const payload = { 
        name, 
        email, 
        password, 
        role,
        recaptchaToken: token // Pass it to the backend!
      };

      const res = await axios.post('http://localhost:5000/user/register', payload);
      console.log("Registration request submitted for approval.");
      navigate('/login');

    } catch (err) {
      // Handle both reCAPTCHA rejections and validation errors
      setError(err.response?.data?.errors?.[0] || err.response?.data?.message || "Registration failed. Please try again.");
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
              <h1>Request Access</h1>
              <p>Register for authorization to the IoT Dashboard.</p>
            </header>

            <form className="login-form" onSubmit={handleRegister}>
              {error && <div className="error-message" style={{ color: '#fb7185', marginBottom: '15px', fontSize: '0.875rem' }}>{error}</div>}
              
              <div className="input-group">
                <label>Full Name</label>
                <input 
                  type="text" 
                  placeholder="Enter your full name" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required 
                />
              </div>

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
                <label>Create Access Key</label>
                <input 
                  type="password" 
                  placeholder="Minimum 8 characters" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                  minLength="8" 
                />
              </div>

              <div className="input-group">
                <label>Account Type</label>
                <select 
                  className="role-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#1e293b', color: 'white', border: '1px solid #334155' }}
                >
                  <option value="Tenant">Tenant / Unit Owner</option>
                  <option value="FM">Facilities Manager (Admin)</option>
                </select>
              </div>

              <button type="submit" className="login-submit-btn">
                Submit Request <span className="button-icon">→</span>
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