import React from 'react';
import { Link } from 'react-router-dom';

const NodeCard = ({ id, name, type, status, uptime }) => {
  // The color logic moves inside the component!
  let statusClass = '';
  if (status === 'Active') statusClass = 'status-active';
  if (status === 'Warning') statusClass = 'status-warning';
  if (status === 'Error') statusClass = 'status-error';

  return (
    <div className="node-card">
      <div className="node-card-header">
        <span className="node-id">{id}</span>
        <span className={`status-badge ${statusClass}`}>
          {status}
        </span>
      </div>
      
      <h3 className="node-name">{name}</h3>
      <p className="node-type">{type}</p>
      
      <div className="node-card-footer">
        <span className="uptime-label">Uptime:</span>
        <span className="uptime-value">{uptime}</span>
      </div>
      
      <Link to="/dashboard" className="view-details-btn">
        View Diagnostics →
      </Link>
    </div>
  );
};

export default NodeCard;