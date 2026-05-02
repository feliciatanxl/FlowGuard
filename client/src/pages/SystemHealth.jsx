import React from 'react';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import NodeCard from '../components/NodeCard';
import '../css/SystemHealth.css'; 

const SystemHealth = () => {
  
  const machineryNodes = [
    { id: 'N-01', name: 'Sector 4 Cold Storage', type: 'Temp/Humidity', status: 'Active', uptime: '99.9%' },
    { id: 'N-02', name: 'Loading Bay AI CCTV', type: 'Visual Surveillance', status: 'Active', uptime: '100%' },
    { id: 'N-03', name: 'Conveyor Belt B', type: 'Motor & Vibration', status: 'Warning', uptime: '92.4%' },
    { id: 'N-04', name: 'Pest Detection Node 7', type: 'Infrared & Motion', status: 'Error', uptime: 'Offline' },
    { id: 'N-05', name: 'HVAC System Central', type: 'Airflow Control', status: 'Active', uptime: '99.5%' },
    { id: 'N-06', name: 'Packaging Arm Alpha', type: 'Robotics', status: 'Active', uptime: '98.2%' },
  ];

  return (
    <div className="system-health-page">
      <NavBar />
      
      <main className="health-main">
        <header className="health-header">
          <h1>Node Network Health</h1>
          <p>Real-time telemetry and status of Harrison Food Factory infrastructure.</p>
        </header>

        <section className="node-grid">
          {machineryNodes.map((node) => (
            <NodeCard 
              key={node.id}
              id={node.id}
              name={node.name}
              type={node.type}
              status={node.status}
              uptime={node.uptime}
            />
          ))}
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default SystemHealth;