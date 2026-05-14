import React, { useState } from 'react'; 
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios'; 
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'; 
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
  const [tenantCode, setTenantCode] = useState(''); // 1. New state for the secret code
  const [error, setError] = useState(null);

  const { executeRecaptcha } = useGoogleReCaptcha();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);

    if (!executeRecaptcha) {
      setError("Security system is still loading. Please try again.");
      return;
    }

    try {
      const token = await executeRecaptcha('register_submit');

      // 2. Include the tenantCode in the payload ONLY if they are staff
      const payload = { 
        name, 
        email, 
        password, 
        role,
        tenantCode: role === 'Staff' ? tenantCode : null, 
        recaptchaToken: token 
      };

      const res = await axios.post('http://localhost:5000/user/register', payload);
      console.log("Registration request submitted for approval.");
      navigate('/login');

    } catch (err) {
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
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#1e293b', color: 'white', border: '1px solid #334155', marginBottom: role === 'Staff' ? '0' : '15px' }}
                >
                  <option value="Tenant">Tenant / Unit Owner</option>
                  <option value="FM">Facilities Manager (Admin)</option>
                  <option value="Staff">Factory Staff</option> {/* 3. Added Staff Option */}
                </select>
              </div>

              {/* 4. The Blockade: Only show this if "Staff" is selected */}
              {role === 'Staff' && (
                <div className="input-group" style={{ animation: 'fadeIn 0.3s ease-in-out', marginTop: '15px', marginBottom: '15px' }}>
                  <label>Company Registration Code</label>
                  <input 
                    type="text" 
                    placeholder="e.g. HARRISON-99X" 
                    value={tenantCode}
                    onChange={(e) => setTenantCode(e.target.value)}
                    required={role === 'Staff'} // Force them to fill it out
                    style={{ borderColor: '#3b82f6', outline: 'none', boxShadow: '0 0 0 1px #3b82f6' }} // Give it a nice blue highlight to draw attention
                  />
                  <small style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '5px', display: 'block' }}>
                    Ask your unit manager for this code.
                  </small>
                </div>
              )}

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