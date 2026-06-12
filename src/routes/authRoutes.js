const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const {
  sendVerificationCode,
  sendRegistrationSuccess,
} = require("../utils/emailService");

const router = express.Router();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const createToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post("/register", async (req, res) => {
  try {
    const { first_name, last_name, business_name, email, phone, password } = req.body;

      if (!first_name || !last_name || !email || !phone || !password) {
      return res.status(400).json({
        message: "Name, email, phone and password are required",
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
          phone = ?,
          password_hash = ?,
          email_verification_code = ?,
          email_verification_expires = DATE_ADD(NOW(), INTERVAL 10 MINUTE)
        WHERE user_id = ?
        `,
        [
          first_name,
          last_name,
          business_name || null,
          phone,
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
    console.error(error);
    res.status(500).json({
      message: "Registration failed",
    });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

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

    await sendRegistrationSuccess(user.email, `${user.first_name} ${user.last_name}`);

    const token = createToken(user);

    res.cookie("token", token, cookieOptions);

    res.json({
      message: "Email verified successfully",
      user: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: `${user.first_name} ${user.last_name}`,
        business_name: user.business_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Email verification failed",
    });
  }
});

router.post("/resend-code", async (req, res) => {
  try {
    const { email } = req.body;

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
    console.error(error);
    res.status(500).json({
      message: "Failed to resend verification code",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

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

    if (!rows.length) {
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
        full_name: `${user.first_name} ${user.last_name}`,
        business_name: user.business_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Login failed",
    });
  }
});

router.get("/me", async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        message: "Not logged in",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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

    const isMatch = await bcrypt.compare(
      current_password,
      user.password_hash
    );

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


router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    path: "/",
  });

  res.json({
    message: "Logged out",
  });
});

module.exports = router;