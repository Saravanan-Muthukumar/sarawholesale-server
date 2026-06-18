const express = require("express");
const router = express.Router();
const db = require("../config/db");
const requireAuth = require("../middleware/authMiddleware");

router.get("/my-orders", requireAuth, async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [orders] = await db.query(
      `
      SELECT
        o.order_request_id,
        o.order_request_number,
        o.subtotal,
        o.vat_amount,
        o.total_amount,
        o.status,
        o.created_at,
        COUNT(oi.order_request_item_id) AS item_count
      FROM order_requests o
      LEFT JOIN order_request_items oi
        ON o.order_request_id = oi.order_request_id
      WHERE o.user_id = ?
      GROUP BY o.order_request_id
      ORDER BY o.created_at DESC
      `,
      [user_id]
    );

    res.json(orders);
  } catch (error) {
    console.error("Get my orders error:", error);
    res.status(500).json({ message: "Failed to load orders" });
  }
});

router.get("/:orderNumber", requireAuth, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const user_id = req.user.user_id;

    const [orders] = await db.query(
      `
      SELECT *
      FROM order_requests
      WHERE order_request_number = ?
      AND user_id = ?
      LIMIT 1
      `,
      [orderNumber, user_id]
    );

    if (!orders.length) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orders[0];

    const [items] = await db.query(
      `
      SELECT *
      FROM order_request_items
      WHERE order_request_id = ?
      ORDER BY order_request_item_id ASC
      `,
      [order.order_request_id]
    );

    res.json({
      order,
      items,
    });
  } catch (error) {
    console.error("Get order details error:", error);
    res.status(500).json({ message: "Failed to load order details" });
  }
});

module.exports = router;