import React from 'react';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/SystemHealth.css'; 

const SystemHealth = () => {
  return (
    <div className="system-health-page">
      <NavBar />
      
      {/* Reduced pt-32 to pt-16 | Increased pb-20 to pb-44 */}
      <main className="pt-16 pb-44 px-6 max-w-7xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">Node Network Health</h1>
          <p className="text-slate-400">Real-time status of Harrison Food Factory IoT infrastructure.</p>
        </header>

        <section className="status-card-large">
          <div className="status-icon">📡</div>
          <h2 className="text-2xl font-semibold text-white">All Systems Operational</h2>
          <p className="text-slate-400 mt-2">
            The EchoSync model is currently monitoring all 128 active nodes.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default SystemHealth;