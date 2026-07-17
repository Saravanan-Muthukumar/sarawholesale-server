const express = require("express");
const Stripe = require ("stripe")

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/payments/create-payment-intent
 */
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency = "gbp", orderNumber } = req.body;

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        message: "A valid payment amount is required.",
      });
    }

    /*
      Stripe expects the amount in the smallest currency unit.

      Example:
      £20.50 becomes 2050 pence.
    */
    const amountInPence = Math.round(numericAmount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPence,
      currency: String(currency).toLowerCase(),

      metadata: {
        order_number: orderNumber ? String(orderNumber) : "",
      },
    });

    return res.status(201).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: numericAmount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    console.error("Create PaymentIntent error:", error);

    return res.status(500).json({
      message:
        error?.message ||
        "Unable to initialise the payment. Please try again.",
    });
  }
});

module.exports = router;