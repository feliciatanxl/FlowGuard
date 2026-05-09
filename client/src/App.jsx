import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/home'; 
import SystemHealth from './pages/SystemHealth';
import Contact from './pages/Contact';
import Login from './pages/Login';
import ForgotKey from './pages/ForgotKey';
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import SystemError from "./pages/SystemError";
import AIInnovation from './pages/AIInnovation';
import Settings from './pages/Settings';
import Users from './pages/Users';
import './App.css';

function App() {
  return (
    <div className="App bg-[#0f172a] min-h-screen text-slate-200 selection:bg-blue-500/30">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/system-health" element={<SystemHealth />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotKey />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/innovation" element={<AIInnovation />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<Users />} />
        <Route path="/error/400" element={
          <SystemError 
            code="400" 
            title="Invalid Data Payload" 
            message="The monitoring sector received a malformed request. Please check your sensor inputs and try again."
            returnPath="/dashboard"
            returnText="Return to Command Center"
          />
        } />
        <Route path="/error/401" element={
          <SystemError 
            code="401" 
            title="Authentication Required" 
            message="Your FlowGuard session has expired or your access key is invalid. Please authenticate to view this dashboard."
            returnPath="/login"
            returnText="Return to Login"
          />
        } />
        <Route path="/error/403" element={
          <SystemError 
            code="403" 
            title="Clearance Denied" 
            message="You do not have the required administrative clearance to access this sector of the Harrison Food Factory."
            returnPath="/dashboard"
            returnText="Back to Permitted Zones"
          />
        } />
        <Route path="/error/500" element={
          <SystemError 
            code="500" 
            title="Database Synchronization Failure" 
            message="FlowGuard core servers are currently unreachable. Our automated AI systems are attempting to restore the connection."
            returnPath="/dashboard"
            returnText="Retry Connection"
          />
        } />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

export default App;