import React from 'react';

const TechStack = () => {
  const technologies = [
    "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"
  ];

  // We double the array to create a seamless infinite loop
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