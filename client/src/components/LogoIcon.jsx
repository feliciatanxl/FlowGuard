import React from 'react';

const LogoIcon = ({ size = 30, className = "" }) => {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 256 256" 
      width={size} 
      height={size}
      className={className}
    >
      <defs>
        {/* Deep, Premium Shield Gradient */}
        <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1e3a8a" /> 
        </linearGradient>
        
        {/* Glowing Data Flow Gradient */}
        <linearGradient id="flowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.1" />
        </linearGradient>

        {/* High-Tech Neon Glow Filter */}
        <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Main Shield Body (The "Guard") */}
      <path 
        d="M128 16 L224 56 V116 C224 172 184 216 128 240 C72 216 32 172 32 116 V56 Z" 
        fill="url(#shieldGrad)" 
      />
      
      {/* Inner Shield Bevel/Highlight for depth */}
      <path 
        d="M128 16 L224 56 V116 C224 172 184 216 128 240 C72 216 32 172 32 116 V56 Z" 
        fill="none" 
        stroke="#ffffff" 
        strokeWidth="3" 
        opacity="0.2" 
      />

      {/* Intersecting Data Waves (The "Flow") */}
      <path d="M 32 100 Q 128 40, 224 140" fill="none" stroke="url(#flowGrad)" strokeWidth="8" />
      <path d="M 32 150 Q 128 210, 224 110" fill="none" stroke="url(#flowGrad)" strokeWidth="8" />

      {/* The AI Sensor Core */}
      <circle cx="128" cy="128" r="28" fill="#0f172a" />
      <circle cx="128" cy="128" r="18" fill="none" stroke="#60a5fa" strokeWidth="4" strokeDasharray="10 6" />
      <circle cx="128" cy="128" r="8" fill="#ffffff" filter="url(#neonGlow)" />

      {/* Integrated Active Status Node (Top Right) */}
      <circle cx="224" cy="56" r="14" fill="#0f172a" /> 
      <circle cx="224" cy="56" r="8" fill="#10b981" />
      <circle cx="224" cy="56" r="4" fill="#ffffff" opacity="0.8" />
    </svg>
  );
};

export default LogoIcon;