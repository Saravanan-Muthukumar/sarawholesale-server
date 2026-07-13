const express = require("express");
const router = express.Router();
const db = require("../config/db");

// POST /api/subscriptions
router.post("/", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: "Please enter your email address.",
      });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    // Insert only when this email does not already exist.
    await db.query(
      `
        INSERT IGNORE INTO subscriptions (
          email,
          created_at
        )
        VALUES (?, NOW())
      `,
      [email]
    );

    // Send the email every time the form is submitted.
    try {
      await sendSubscriptionEmail(email);
    } catch (emailError) {
      console.error("Subscription email error:", emailError);
    }

    // Always return success for valid email addresses.
    return res.status(200).json({
      success: true,
      message:
        "Thank you for subscribing. Please check your email for your voucher.",
    });
  } catch (error) {
    console.error("Subscription error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to subscribe. Please try again.",
    });
  }
});

module.exports = router;