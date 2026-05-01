import React from 'react';

const Hero = () => {
  return (
    <section className="hero-container">
      <h1 className="hero-title">FlowGuard</h1>
      
      <p className="hero-description">
        The intelligent backbone for the new Harrison Food Factory. 
        Reducing operational errors and manpower reliance through AI-driven surveillance and logistics.
      </p>
      
      <button className="hero-button">
        Explore AI Innovation
        <svg 
          className="button-icon" 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      </button>
    </section>
  );
};

export default Hero;