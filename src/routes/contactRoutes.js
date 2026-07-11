const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const {
  sendContactFormEmail,
  sendContactAcknowledgementEmail,
} = require("../utils/emailService");

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many messages submitted. Please try again later.",
  },
});

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const containsHeaderInjection = (value) => {
  return /[\r\n]/.test(value);
};

router.post("/", contactLimiter, async (req, res) => {
  try {
    const name =
      typeof req.body.name === "string" ? req.body.name.trim() : "";

    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const phone =
      typeof req.body.phone === "string" ? req.body.phone.trim() : "";

    const subject =
      typeof req.body.subject === "string" ? req.body.subject.trim() : "";

    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email, subject and message are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    if (
      containsHeaderInjection(name) ||
      containsHeaderInjection(email) ||
      containsHeaderInjection(subject) ||
      containsHeaderInjection(phone)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid contact form input",
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must not exceed 100 characters",
      });
    }

    if (email.length > 254) {
      return res.status(400).json({
        success: false,
        message: "Email address is too long",
      });
    }

    if (phone.length > 30) {
      return res.status(400).json({
        success: false,
        message: "Phone number must not exceed 30 characters",
      });
    }

    if (subject.length > 150) {
      return res.status(400).json({
        success: false,
        message: "Subject must not exceed 150 characters",
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Message must not exceed 5,000 characters",
      });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("Contact email environment variables are missing");

      return res.status(503).json({
        success: false,
        message:
          "The contact service is temporarily unavailable. Please try again later.",
      });
    }

    // Send the main enquiry first so acknowledgement failure
    // does not prevent SARA Wholesale from receiving the message.
    await sendContactFormEmail({
      name,
      email,
      phone,
      subject,
      message,
    });

    // The customer acknowledgement is non-critical.
    try {
      await sendContactAcknowledgementEmail({
        name,
        email,
        subject,
      });
    } catch (acknowledgementError) {
      console.error(
        "Contact acknowledgement email error:",
        acknowledgementError
      );
    }

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
    });
  } catch (err) {
    console.error("Contact form email error:", err);

    return res.status(500).json({
      success: false,
      message:
        "Unable to send your message at the moment. Please try again later.",
    });
  }
});

module.exports = router;