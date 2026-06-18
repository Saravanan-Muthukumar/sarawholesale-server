const express = require("express");
const router = express.Router();
const db = require("../config/db");
const requireAuth = require("../middleware/authMiddleware");
const { sendOrderRequestEmail } = require("../utils/emailService");

async function getOrCreateActiveCart(user_id) {
  const [existingCart] = await db.query(
    `
    SELECT cart_id
    FROM carts
    WHERE user_id = ?
    AND status = 'ACTIVE'
    LIMIT 1
    `,
    [user_id]
  );

  if (existingCart.length) {
    return existingCart[0].cart_id;
  }

  const [result] = await db.query(
    `
    INSERT INTO carts (user_id, status)
    VALUES (?, 'ACTIVE')
    `,
    [user_id]
  );

  return result.insertId;
}

async function getActiveCartItems(user_id) {
  const [rows] = await db.query(
    `
    SELECT 
      ci.cart_item_id,
      ci.cart_id,
      ci.product_id,
      ci.quantity,
      ci.unit_price,
      p.product_name,
      p.sku,
      p.slug,
      pi.image_url
    FROM carts c
    JOIN cart_items ci ON c.cart_id = ci.cart_id
    JOIN products p ON ci.product_id = p.product_id
    LEFT JOIN product_images pi 
      ON p.product_id = pi.product_id 
      AND pi.is_main = 1
    WHERE c.user_id = ?
    AND c.status = 'ACTIVE'
    ORDER BY ci.cart_item_id DESC
    `,
    [user_id]
  );

  return rows;
}

router.post("/add", requireAuth, async (req, res) => {
  console.log("========== ADD TO CART ==========");
  console.log("User:", req.user);
  console.log("Body:", req.body);
  try {
    const { product_id, quantity = 1, unit_price } = req.body;

    if (!product_id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    const user_id = req.user.user_id;
    const cart_id = await getOrCreateActiveCart(user_id);

    await db.query(
      `
      INSERT INTO cart_items (cart_id, product_id, quantity, unit_price)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        quantity = quantity + VALUES(quantity),
        unit_price = VALUES(unit_price)
      `,
      [cart_id, product_id, quantity, unit_price || null]
    );

    res.status(201).json({ message: "Item added to cart" });
  } catch (error) {
    console.error("Add to cart error:", error);
    res.status(500).json({ message: "Failed to add item to cart" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await getActiveCartItems(req.user.user_id);
    res.json(rows);
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({ message: "Failed to load cart" });
  }
});

router.put("/update", requireAuth, async (req, res) => {
  try {
    const { cart_item_id, quantity } = req.body;
    const user_id = req.user.user_id;

    if (!cart_item_id || quantity === undefined) {
      return res.status(400).json({
        message: "Cart item and quantity are required",
      });
    }

    if (Number(quantity) <= 0) {
      await db.query(
        `
        DELETE ci FROM cart_items ci
        JOIN carts c ON ci.cart_id = c.cart_id
        WHERE ci.cart_item_id = ?
        AND c.user_id = ?
        AND c.status = 'ACTIVE'
        `,
        [cart_item_id, user_id]
      );

      return res.json({ message: "Item removed from cart" });
    }

    await db.query(
      `
      UPDATE cart_items ci
      JOIN carts c ON ci.cart_id = c.cart_id
      SET ci.quantity = ?
      WHERE ci.cart_item_id = ?
      AND c.user_id = ?
      AND c.status = 'ACTIVE'
      `,
      [quantity, cart_item_id, user_id]
    );

    res.json({ message: "Cart updated" });
  } catch (error) {
    console.error("Update cart error:", error);
    res.status(500).json({ message: "Failed to update cart" });
  }
});

router.delete("/item/:id", requireAuth, async (req, res) => {
  try {
    const cart_item_id = req.params.id;
    const user_id = req.user.user_id;

    await db.query(
      `
      DELETE ci FROM cart_items ci
      JOIN carts c ON ci.cart_id = c.cart_id
      WHERE ci.cart_item_id = ?
      AND c.user_id = ?
      AND c.status = 'ACTIVE'
      `,
      [cart_item_id, user_id]
    );

    res.json({ message: "Item removed from cart" });
  } catch (error) {
    console.error("Delete cart item error:", error);
    res.status(500).json({ message: "Failed to remove cart item" });
  }
});

router.post("/request-order", requireAuth, async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const user_id = req.user.user_id;

    const [cartRows] = await connection.query(
      `
      SELECT cart_id
      FROM carts
      WHERE user_id = ?
      AND status = 'ACTIVE'
      LIMIT 1
      `,
      [user_id]
    );


    if (!cartRows.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Cart is empty" });
    }

    const cart_id = cartRows[0].cart_id;

    const [items] = await connection.query(
      `
      SELECT 
        ci.cart_item_id,
        ci.product_id,
        ci.quantity,
        ci.unit_price,
        p.product_name,
        p.sku
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.product_id
      WHERE ci.cart_id = ?
      `,
      [cart_id]
    );

    if (!items.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Cart is empty" });
    }


    const subtotal = Number(
      items
        .reduce((sum, item) => {
          return sum + Number(item.quantity) * Number(item.unit_price || 0);
        }, 0)
        .toFixed(2)
    );
    
    const vatAmount = Number((subtotal * 0.2).toFixed(2));
    const totalAmount = Number((subtotal + vatAmount).toFixed(2));
    
    const orderRequestNumber = `SOR-${Date.now()}`;

    const [orderResult] = await connection.query(
      `
      INSERT INTO order_requests
      (
        order_request_number,
        user_id,
        cart_id,
        subtotal,
        vat_amount,
        total_amount,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'REQUEST_SUBMITTED')
      `,
      [orderRequestNumber, user_id, cart_id, subtotal, vatAmount, totalAmount]
    );

    const order_request_id = orderResult.insertId;

    for (const item of items) {
      await connection.query(
        `
        INSERT INTO order_request_items
        (
          order_request_id,
          product_id,
          product_name,
          sku,
          quantity,
          unit_price,
          line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          order_request_id,
          item.product_id,
          item.product_name,
          item.sku,
          item.quantity,
          item.unit_price,
          Number(item.quantity) * Number(item.unit_price || 0),
        ]
      );
    }

    await connection.query(
      `
      UPDATE carts
      SET status = 'ORDERED'
      WHERE cart_id = ?
      `,
      [cart_id]
    );

    await connection.commit();

    const [userRows] = await db.query(
      `
      SELECT first_name, last_name, email, phone
      FROM users
      WHERE user_id = ?
      LIMIT 1
      `,
      [user_id]
    );

    const user = userRows[0];

    const customerName = `${user?.first_name || ""} ${
      user?.last_name || ""
    }`.trim();

    if (user?.email) {
      await sendOrderRequestEmail({
        email: user.email,
        customerName,
        customerPhone: user.phone,
        orderRequestNumber,
        subtotal,
        vatAmount,
        totalAmount,
        items,
      });
    }

    if (process.env.HOST_EMAIL) {
      await sendOrderRequestEmail({
        email: process.env.HOST_EMAIL,
        customerName,
        customerPhone: user?.phone,
        orderRequestNumber,
        subtotal,
        vatAmount,
        totalAmount,
        items,
      });
    }

    res.status(201).json({
      message: "Order request submitted",
      order_request_id,
      order_request_number: orderRequestNumber,
      status: "REQUEST_SUBMITTED",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Request order error:", error);
    res.status(500).json({
      message: "Failed to submit order request",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;