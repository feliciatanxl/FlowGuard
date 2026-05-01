import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/home';
import SystemHealth from './pages/SystemHealth';
import Contact from './pages/Contact';
import Login from './pages/Login';
import './App.css';

function App() {
  return (
    <div className="App bg-[#0f172a] min-h-screen text-slate-200 selection:bg-blue-500/30">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/system-health" element={<SystemHealth />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<div className="p-20 text-center"><h1>404: Node Network Disconnected</h1></div>} />
      </Routes>
    </div>
  );
}

export default App;