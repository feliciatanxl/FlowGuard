import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children, requiredRole, allowedRoles }) => {
    const token = localStorage.getItem("accessToken");
    const userRole = localStorage.getItem("userRole");

    // 1. No token? Redirect to Unauthorized Error
    if (!token) {
        return <Navigate to="/error/401" replace />;
    }

    // 2. Build the list of roles that may view this page.
    //    - `requiredRole="FM"`              → single-role pages (back-compatible)
    //    - `allowedRoles={['FM','Tenant']}` → pages shared by a few roles
    const permitted = allowedRoles
        ? allowedRoles
        : requiredRole
            ? [requiredRole]
            : null;

    // 3. Wrong Role? Redirect to Forbidden Error
    if (permitted && !permitted.includes(userRole)) {
        return <Navigate to="/error/403" replace />;
    }

    // 4. Authenticated (and authorised)? Show the page
    return children;
};

export default ProtectedRoute;