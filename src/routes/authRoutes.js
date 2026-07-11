const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const {
  sendVerificationCode,
  sendRegistrationSuccess,
} = require("../utils/emailService");

const {
  sendResetPasswordEmail,
} = require("../utils/emailServiceResetPassword");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    message: "Too many registration attempts. Please try again later.",
  },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    message: "Too many password reset requests. Please try again later.",
  },
});

const resendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    message: "Too many verification code requests. Please try again later.",
  },
});

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const createToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
      issuer: "sarawholesale",
      audience: "customer",
    }
  );
};

const isProduction = process.env.NODE_ENV === "production";

// Dynamic cookie settings that won't break local development
const cookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const first_name = String(req.body.first_name || "").trim();
    const last_name = String(req.body.last_name || "").trim();
    const business_name = String(req.body.business_name || "").trim();
    const email = normalizeEmail(req.body.email);
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");

    if (!first_name || !last_name || !email || !phone || !password) {
      return res.status(400).json({
        message: "Name, email, phone and password are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address",
      });
    }

    if (first_name.length > 100 || last_name.length > 100) {
      return res.status(400).json({
        message: "Name is too long",
      });
    }

    if (business_name.length > 150) {
      return res.status(400).json({
        message: "Business name is too long",
      });
    }

    const normalizedPhone = phone.replace(/[\s()-]/g, "");

    if (!/^\+?[0-9]{10,15}$/.test(normalizedPhone)) {
      return res.status(400).json({
        message: "Please enter a valid phone number",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const [existing] = await db.query(
      "SELECT user_id, email_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (existing.length && existing[0].email_verified === 1) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const code = generateCode();

    if (existing.length && existing[0].email_verified === 0) {
      await db.query(
        `
        UPDATE users
        SET
          first_name = ?,
          last_name = ?,
          business_name = ?,
          normalizedPhone = ?,
          password_hash = ?,
          email_verification_code = ?,
          email_verification_expires = DATE_ADD(NOW(), INTERVAL 10 MINUTE)
        WHERE user_id = ?
        `,
        [
          first_name,
          last_name,
          business_name || null,
          normalizedPhone,
          password_hash,
          code,
          existing[0].user_id,
        ]
      );

      await sendVerificationCode(email, code);

      return res.json({
        message: "Verification code sent to your email",
        email,
        requiresVerification: true,
      });
    }

    await db.query(
      `
      INSERT INTO users
      (
        first_name,
        last_name,
        business_name,
        email,
        phone,
        password_hash,
        role,
        email_verified,
        email_verification_code,
        email_verification_expires
      )
      VALUES (?, ?, ?, ?, ?, ?, 'CUSTOMER', 0, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
      `,
      [
        first_name,
        last_name,
        business_name || null,
        email,
        phone,
        password_hash,
        code,
      ]
    );

    await sendVerificationCode(email, code);

    res.json({
      message: "Verification code sent to your email",
      email,
      requiresVerification: true,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      message: "Registration failed",
    });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const {code } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !code) {
      return res.status(400).json({
        message: "Email and verification code are required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT *
      FROM users
      WHERE email = ?
      AND email_verification_code = ?
      AND email_verification_expires > NOW()
      LIMIT 1
      `,
      [email, code]
    );

    if (!rows.length) {
      return res.status(400).json({
        message: "Invalid or expired verification code",
      });
    }

    const user = rows[0];

    await db.query(
      `
      UPDATE users
      SET
        email_verified = 1,
        email_verification_code = NULL,
        email_verification_expires = NULL
      WHERE user_id = ?
      `,
      [user.user_id]
    );

    await sendRegistrationSuccess(
      user.email,
      `${user.first_name} ${user.last_name}`.trim()
    );

    const token = createToken(user);

    res.cookie("token", token, cookieOptions);

    res.json({
      message: "Email verified successfully",
      user: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: `${user.first_name} ${user.last_name}`.trim(),
        business_name: user.business_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Verify email error:", error);
    res.status(500).json({
      message: "Email verification failed",
    });
  }
});

router.post(
  "/resend-code",
  resendCodeLimiter,
  async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT user_id, email_verified
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    if (rows[0].email_verified === 1) {
      return res.status(400).json({
        message: "Email already verified",
      });
    }

    const code = generateCode();

    await db.query(
      `
      UPDATE users
      SET
        email_verification_code = ?,
        email_verification_expires = DATE_ADD(NOW(), INTERVAL 10 MINUTE)
      WHERE user_id = ?
      `,
      [code, rows[0].user_id]
    );

    await sendVerificationCode(email, code);

    res.json({
      message: "Verification code resent",
    });
  } catch (error) {
    console.error("Resend code error:", error);
    res.status(500).json({
      message: "Failed to resend verification code",
    });
  }
}
);

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    const [rows] = await db.query(
      `
      SELECT *
      FROM users
      WHERE email = ?
      AND is_active = 1
      LIMIT 1
      `,
      [email]
    );

    // Timing attack mitigation: if user isn't found, check password against a dummy hash
    if (!rows.length) {
      await bcrypt.compare(password, "$2b$10$NotRealHashToPreventTimingAttacksStandardString");
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (user.email_verified !== 1) {
      return res.status(403).json({
        message: "Please verify your email before login",
        requiresVerification: true,
        email: user.email,
      });
    }

    const token = createToken(user);

    res.cookie("token", token, cookieOptions);

    res.json({
      message: "Login successful",
      user: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: `${user.first_name} ${user.last_name}`.trim(),
        business_name: user.business_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Login failed",
    });
  }
});

router.get("/test-cookie", (req, res) => {
  res.json({
    cookies: req.cookies,
    hasToken: !!(req.cookies && req.cookies.token),
  });
});

router.get("/me", async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        message: "Not logged in",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "sarawholesale",
      audience: "customer",
    });

    const [rows] = await db.query(
      `
      SELECT
        user_id,
        first_name,
        last_name,
        CONCAT(first_name, ' ', last_name) AS full_name,
        business_name,
        email,
        phone,
        role
      FROM users
      WHERE user_id = ?
      AND is_active = 1
      LIMIT 1
      `,
      [decoded.user_id]
    );

    if (!rows.length) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    res.json({
      user: rows[0],
    });
  } catch (error) {
    console.error("AUTH ME ERROR:", error.message);
    res.status(401).json({
      message: "Invalid session",
      error: error.message,
    });
  }
});

router.put("/change-password", async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        message: "Not logged in",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "sarawholesale",
      audience: "customer",
    });
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters",
      });
    }

    const [rows] = await db.query(
      `
      SELECT user_id, password_hash
      FROM users
      WHERE user_id = ?
      AND is_active = 1
      LIMIT 1
      `,
      [decoded.user_id]
    );

    if (!rows.length) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const newPasswordHash = await bcrypt.hash(new_password, 10);

    await db.query(
      `
      UPDATE users
      SET password_hash = ?
      WHERE user_id = ?
      `,
      [newPasswordHash, user.user_id]
    );

    res.json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      message: "Failed to update password",
    });
  }
});

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const [users] = await db.query(
      `
      SELECT user_id, email, first_name, last_name
      FROM users
      WHERE email = ?
      AND is_active = 1
      LIMIT 1
      `,
      [email]
    );

    // Standard trick: always return success to mask user presence
    if (!users.length) {
      return res.json({
        message: "Password reset email sent. Please check your inbox.",
      });
    }

    const user = users[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    await db.query(
      `
      DELETE FROM password_resets
      WHERE user_id = ?
      `,
      [user.user_id]
    );

    await db.query(
      `
      INSERT INTO password_resets
      (
        user_id,
        token,
        expires_at
      )
      VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
      `,
      [user.user_id, hashedToken]
    );

    const resetLink = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;
    const customerName = `${user.first_name || ""} ${user.last_name || ""}`.trim();

    await sendResetPasswordEmail({
      email: user.email,
      name: customerName,
      resetLink,
    });

    res.json({
      message: "Password reset email sent. Please check your inbox.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      message: "Failed to send reset email",
    });
  }
}
);

router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Token and password are required",
      });
    }

    // Fixed mismatch: Increased password validation from 6 to 8 to keep it consistent
    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const [rows] = await db.query(
      `
      SELECT *
      FROM password_resets
      WHERE token = ?
      AND expires_at > NOW()
      LIMIT 1
      `,
      [hashedToken]
    );

    if (!rows.length) {
      return res.status(400).json({
        message: "Invalid or expired reset link",
      });
    }

    const reset = rows[0];
    const password_hash = await bcrypt.hash(password, 10);

    await db.query(
      `
      UPDATE users
      SET password_hash = ?
      WHERE user_id = ?
      `,
      [password_hash, reset.user_id]
    );

    await db.query(
      `
      DELETE FROM password_resets
      WHERE user_id = ?
      `,
      [reset.user_id]
    );

    res.json({
      message: "Password reset successful",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      message: "Password reset failed",
    });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", cookieOptions);
  res.json({
    message: "Logged out",
  });
});

module.exports = router;