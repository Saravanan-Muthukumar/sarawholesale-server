const express = require("express");
const router = express.Router();
const db = require("../config/db");

// POST /api/subscriptions
router.post("/", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    const offerCode = "VOUCHER5";
    const offerDetails = "£5 voucher for subscribing to offers and updates";

    const [existing] = await db.query(
      "SELECT subscription_id FROM subscriptions WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "This email is already subscribed",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO subscriptions
      (
        email,
        offer_code,
        offer_details
      )
      VALUES (?, ?, ?)
      `,
      [email, offerCode, offerDetails]
    );

    res.status(201).json({
      success: true,
      message: "Thank you for subscribing",
      subscriptionId: result.insertId,
      offerCode,
      offerDetails,
    });
  } catch (err) {
    console.error("Subscription error:", err);

    res.status(500).json({
      success: false,
      message: "Subscription failed",
    });
  }
});

module.exports = router;