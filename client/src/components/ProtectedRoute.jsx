import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children, requiredRole }) => {
    const token = localStorage.getItem("accessToken");
    const userRole = localStorage.getItem("userRole");

    // 1. No token? Redirect to Unauthorized Error
    if (!token) {
        return <Navigate to="/error/401" replace />;
    }

    // 2. Wrong Role? Redirect to Forbidden Error
    if (requiredRole && userRole !== requiredRole) {
        return <Navigate to="/error/403" replace />;
    }

    // 3. Authenticated? Show the page
    return children;
};

export default ProtectedRoute;