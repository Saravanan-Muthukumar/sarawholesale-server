const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  try {
    console.log("========== AUTH CHECK ==========");
    console.log("URL:", req.method, req.originalUrl);
    console.log("Cookies:", req.cookies);

    const token = req.cookies.token;

    if (!token) {
      console.log("❌ NO TOKEN FOUND");
      return res.status(401).json({ message: "Login required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("✅ TOKEN VALID");
    console.log("User:", decoded);

    req.user = decoded;

    next();
  } catch (error) {
    console.log("❌ TOKEN ERROR:", error.message);

    return res.status(401).json({
      message: "Invalid session",
      error: error.message,
    });
  }
}

module.exports = requireAuth;