function requireAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ message: "Login required" });
    }
  
    if (String(req.user.role).toLowerCase() !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }
  
    next();
  }
  
  module.exports = requireAdmin;