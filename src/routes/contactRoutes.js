const express = require("express");
const router = express.Router();

const {
  sendContactFormEmail,
  sendContactAcknowledgementEmail,
} = require("../utils/emailService");

router.post("/", async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        message: "Name, email, subject and message are required",
      });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        message: "Email login details are missing",
      });
    }

    // Send enquiry email to SARA Wholesale Supplies
    await sendContactFormEmail({
      name,
      email,
      phone,
      subject,
      message,
    });

    // Send acknowledgement email to customer
    await sendContactAcknowledgementEmail({
      name,
      email,
      subject,
    });

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
    });
  } catch (err) {
    console.error("Contact form email error:", err);

    return res.status(500).json({
      success: false,
      message: "Server error while sending message",
    });
  }
});

module.exports = router;