import React from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/Login.css'; 

const SystemError = ({ code, title, message, returnPath = "/", returnText = "Return to Safety" }) => {
  
  // Determine which CSS class to apply based on the error code.
  // `code` arrives as a string ("403"), so coerce before comparing.
  const numericCode = Number(code);
  const isCritical = numericCode >= 500 || numericCode === 403;
  const severityClass = isCritical ? 'error-critical' : 'error-warning';

  return (
    <div className="login-page-wrapper">
      <NavBar />
      
      <div className="login-content-area">
        <div className="login-container">
          
          {/* We combine your error-box class with the dynamic severity class */}
          <div className={`login-box error-box ${severityClass}`}>
            
            <div className="error-code">
              {code}
            </div>
            
            <h1 className="error-title">{title}</h1>
            
            <p className="error-desc">
              {message}
            </p>
            
            <Link to={returnPath} className="login-submit-btn error-btn">
              {returnText}
            </Link>

          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default SystemError;