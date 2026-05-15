const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    // 1. Grab the token from the request header
    const authHeader = req.headers['authorization'];
    
    // Tokens usually come in as "Bearer <token_string>", so we split it to just get the string
    const token = authHeader && authHeader.split(' ')[1]; 

    // 2. If there is no token, kick them out
    if (!token) {
        return res.status(401).json({ message: "Access Denied. No security token provided." });
    }

    try {
        // 3. Verify the token using your secret key
        const decoded = jwt.verify(token, process.env.APP_SECRET);
        
        // 4. Attach the decoded user data (like their ID) to the request
        req.user = decoded; 
        
        // 5. Let them through to the actual route!
        next(); 

    } catch (err) {
        return res.status(403).json({ message: "Invalid or expired security token." });
    }
};

module.exports = { verifyToken };