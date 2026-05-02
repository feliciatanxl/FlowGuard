import React from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/Login.css';

const NotFound = () => {
  return (
    <div className="login-page-wrapper">
      <NavBar />
      
      <div className="login-content-area">
        <div className="login-container">
          {/* Added .error-box here */}
          <div className="login-box error-box"> 
            
            <div className="error-code">
              404
            </div>
            
            <h1 className="error-title">Sector Not Found</h1>
            
            <p className="error-desc">
              The monitoring sector or dashboard view you are trying to access does not exist or has been archived by FlowGuard AI.
            </p>
            
            <Link to="/dashboard" className="login-submit-btn error-btn">
              Return to Command Center
            </Link>
            
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default NotFound;