import React from 'react';

const TechStack = () => {
  const technologies = [           
    "NexusCloud Solutions",    
    "OptiTemp Systems",        
    "AeroNode IoT",            
    "Sentinel Security",      
    "OmniStream Data",         
    "Forge Logistics Tech",    
    "NovaVision Optics",        
    "Vertex Edge Computing",    
    "PulseNet Infrastructure",  
    "CipherLock Systems",       
    "Apex Analytics",        
    "Meridian Supply Co.",    
    "Horizon Web Services",     
    "BlueShift Databases",      
    "Harrison Internal"        
  ];
  const displayStack = [...technologies, ...technologies];

  return (
    <section className="tech-stack-section">
      <div className="tech-stack-title">Powered by Enterprise Grade Technology</div>
      <div className="marquee-container">
        <div className="marquee-content">
          {displayStack.map((tech, i) => (
            <div key={i} className="tech-item">
              <span className="tech-dot"></span>
              {tech}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TechStack;