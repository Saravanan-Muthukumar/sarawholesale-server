const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const db = require("../config/db");
const requireAuth = require("../middleware/authMiddleware");
const { sendOrderRequestEmail } = require("../utils/emailService");

/*
|--------------------------------------------------------------------------
| Rate limiters
|--------------------------------------------------------------------------
*/

const cartWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many cart requests. Please try again shortly.",
  },
});

const orderRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many order requests. Please try again later.",
  },
});



/*
|--------------------------------------------------------------------------
| Validation helpers
|--------------------------------------------------------------------------
*/

function parsePositiveInteger(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function parseInteger(value) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return null;
  }

  return number;
}

/*
|--------------------------------------------------------------------------
| Cart helpers
|--------------------------------------------------------------------------
*/

async function getOrCreateActiveCart(userId) {
  const [existingCart] = await db.query(
    `
    SELECT cart_id
    FROM carts
    WHERE user_id = ?
      AND status = 'ACTIVE'
    LIMIT 1
    `,
    [userId]
  );

  if (existingCart.length) {
    return existingCart[0].cart_id;
  }

  const [result] = await db.query(
    `
    INSERT INTO carts (user_id, status)
    VALUES (?, 'ACTIVE')
    `,
    [userId]
  );

  return result.insertId;
}

async function getActiveCartItems(userId) {
  const [rows] = await db.query(
    `
    SELECT
      c.voucher_code,
      c.discount_percent,
      ci.cart_item_id,
      ci.cart_id,
      ci.product_id,
      ci.quantity,
      ci.unit_price,
      ROUND(ci.quantity * ci.unit_price, 2) AS line_total,
      p.product_name,
      p.sku,
      p.slug,
      p.stock_qty,
      pi.image_url,
      COALESCE(ps.spec_value, 'Unit') AS unit
    FROM carts c
    JOIN cart_items ci
      ON c.cart_id = ci.cart_id
    JOIN products p
      ON ci.product_id = p.product_id
    LEFT JOIN product_images pi
      ON p.product_id = pi.product_id
      AND pi.is_main = 1
    LEFT JOIN product_specifications ps
      ON ps.product_id = p.product_id
      AND LOWER(TRIM(ps.spec_name)) = 'unit'
    WHERE c.user_id = ?
      AND c.status = 'ACTIVE'
    ORDER BY ci.cart_item_id DESC
    `,
    [userId]
  );

  return rows;
}

/*
|--------------------------------------------------------------------------
| Secure price calculation
|--------------------------------------------------------------------------
| Never trust unit_price sent by the frontend.
| The server selects the correct tier price from product_prices.
|--------------------------------------------------------------------------
*/

async function getProductUnitPrice(queryRunner, productId, quantity) {
  const [priceRows] = await queryRunner.query(
    `
    SELECT price
    FROM product_prices
    WHERE product_id = ?
      AND min_qty <= ?
      AND (max_qty IS NULL OR max_qty >= ?)
    ORDER BY min_qty DESC
    LIMIT 1
    `,
    [productId, quantity, quantity]
  );

  if (!priceRows.length) {
    return null;
  }

  const price = Number(priceRows[0].price);

  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return Number(price.toFixed(2));
}

/*
|--------------------------------------------------------------------------
| Add item to cart
|--------------------------------------------------------------------------
*/

router.post(
  "/add",
  requireAuth,
  cartWriteLimiter,
  async (req, res) => {
    try {
      const productId = parsePositiveInteger(req.body.product_id);
      const quantity = parsePositiveInteger(req.body.quantity ?? 1);

      if (!productId) {
        return res.status(400).json({
          success: false,
          message: "A valid product ID is required",
        });
      }

      if (!quantity) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be a positive whole number",
        });
      }

      const userId = req.user.user_id;
      const cartId = await getOrCreateActiveCart(userId);

      const [productRows] = await db.query(
        `
        SELECT product_id, product_name, stock_qty
        FROM products
        WHERE product_id = ?
        LIMIT 1
        `,
        [productId]
      );

      if (!productRows.length) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const product = productRows[0];
      const stockQty = Number(product.stock_qty || 0);

      const [existingRows] = await db.query(
        `
        SELECT cart_item_id, quantity
        FROM cart_items
        WHERE cart_id = ?
          AND product_id = ?
        LIMIT 1
        `,
        [cartId, productId]
      );

      const existingQty = Number(existingRows[0]?.quantity || 0);
      const requestedTotalQty = existingQty + quantity;

      if (requestedTotalQty > stockQty) {
        return res.status(409).json({
          success: false,
          message: `Only ${stockQty} available in stock`,
          product_id: productId,
          stock_qty: stockQty,
          quantity_in_cart: existingQty,
          available_to_add: Math.max(stockQty - existingQty, 0),
        });
      }

      const unitPrice = await getProductUnitPrice(
        db,
        productId,
        requestedTotalQty
      );

      if (unitPrice === null) {
        return res.status(400).json({
          success: false,
          message: "A valid price is not available for this quantity",
        });
      }

      await db.query(
        `
        INSERT INTO cart_items
          (cart_id, product_id, quantity, unit_price)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          quantity = quantity + VALUES(quantity),
          unit_price = VALUES(unit_price)
        `,
        [cartId, productId, quantity, unitPrice]
      );

      return res.status(201).json({
        success: true,
        message: "Item added to cart",
        product_id: productId,
        quantity: requestedTotalQty,
        unit_price: unitPrice,
      });
    } catch (error) {
      console.error("Add to cart error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to add item to cart",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Get active cart
|--------------------------------------------------------------------------
*/

router.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await getActiveCartItems(req.user.user_id);

    return res.status(200).json({
      items: rows,
      voucher_code: rows[0]?.voucher_code || "",
      discount_percent: Number(rows[0]?.discount_percent || 0),
    });
  } catch (error) {
    console.error("Get cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load cart",
    });
  }
});

/*
|--------------------------------------------------------------------------
| Update cart quantity
|--------------------------------------------------------------------------
*/

router.put(
  "/update",
  requireAuth,
  cartWriteLimiter,
  async (req, res) => {
    try {
      const cartItemId = parsePositiveInteger(req.body.cart_item_id);
      const quantity = parseInteger(req.body.quantity);
      const userId = req.user.user_id;

      if (!cartItemId || quantity === null) {
        return res.status(400).json({
          success: false,
          message: "A valid cart item and quantity are required",
        });
      }

      if (quantity <= 0) {
        const [deleteResult] = await db.query(
          `
          DELETE ci
          FROM cart_items ci
          JOIN carts c
            ON ci.cart_id = c.cart_id
          WHERE ci.cart_item_id = ?
            AND c.user_id = ?
            AND c.status = 'ACTIVE'
          `,
          [cartItemId, userId]
        );

        if (deleteResult.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: "Cart item not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Item removed from cart",
        });
      }

      const [cartItemRows] = await db.query(
        `
        SELECT
          c.voucher_code,
          c.discount_percent,
          ci.cart_item_id,
          ci.product_id,
          p.stock_qty,
          p.product_name
        FROM cart_items ci
        JOIN carts c
          ON ci.cart_id = c.cart_id
        JOIN products p
          ON ci.product_id = p.product_id
        WHERE ci.cart_item_id = ?
          AND c.user_id = ?
          AND c.status = 'ACTIVE'
        LIMIT 1
        `,
        [cartItemId, userId]
      );

      if (!cartItemRows.length) {
        return res.status(404).json({
          success: false,
          message: "Cart item not found",
        });
      }

      const cartItem = cartItemRows[0];
      const stockQty = Number(cartItem.stock_qty || 0);

      if (quantity > stockQty) {
        return res.status(409).json({
          success: false,
          message: `${cartItem.product_name} has only ${stockQty} available in stock`,
          product_id: cartItem.product_id,
          available_qty: stockQty,
        });
      }

      const unitPrice = await getProductUnitPrice(
        db,
        cartItem.product_id,
        quantity
      );

      if (unitPrice === null) {
        return res.status(400).json({
          success: false,
          message: "A valid price is not available for this quantity",
        });
      }

      await db.query(
        `
        UPDATE cart_items ci
        JOIN carts c
          ON ci.cart_id = c.cart_id
        SET
          ci.quantity = ?,
          ci.unit_price = ?
        WHERE ci.cart_item_id = ?
          AND c.user_id = ?
          AND c.status = 'ACTIVE'
        `,
        [quantity, unitPrice, cartItemId, userId]
      );

      return res.status(200).json({
        success: true,
        message: "Cart updated",
        cart_item_id: cartItemId,
        quantity,
        unit_price: unitPrice,
      });
    } catch (error) {
      console.error("Update cart error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update cart",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Delete cart item
|--------------------------------------------------------------------------
*/

router.delete(
  "/item/:id",
  requireAuth,
  cartWriteLimiter,
  async (req, res) => {
    try {
      const cartItemId = parsePositiveInteger(req.params.id);
      const userId = req.user.user_id;

      if (!cartItemId) {
        return res.status(400).json({
          success: false,
          message: "A valid cart item ID is required",
        });
      }

      const [result] = await db.query(
        `
        DELETE ci
        FROM cart_items ci
        JOIN carts c
          ON ci.cart_id = c.cart_id
        WHERE ci.cart_item_id = ?
          AND c.user_id = ?
          AND c.status = 'ACTIVE'
        `,
        [cartItemId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Cart item not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Item removed from cart",
      });
    } catch (error) {
      console.error("Delete cart item error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to remove cart item",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Submit order request
|--------------------------------------------------------------------------
*/

router.post(
  "/request-order",
  requireAuth,
  orderRequestLimiter,
  async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const userId = req.user.user_id;

      /*
       * Lock the active cart so two order requests cannot process
       * the same cart simultaneously.
       */
      const [cartRows] = await connection.query(
        `
        SELECT
          cart_id,
          voucher_code,
          discount_percent
        FROM carts
        WHERE user_id = ?
          AND status = 'ACTIVE'
        LIMIT 1
        FOR UPDATE
        `,
        [userId]
      );

      if (!cartRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "Cart is empty",
        });
      }

      const cartId = cartRows[0].cart_id;

      /*
       * Lock the products while stock is being validated and deducted.
       */
      const [cartItems] = await connection.query(
        `
        SELECT
          ci.cart_item_id,
          ci.product_id,
          ci.quantity,
          p.product_name,
          p.sku,
          p.stock_qty
        FROM cart_items ci
        JOIN products p
          ON ci.product_id = p.product_id
        WHERE ci.cart_id = ?
        FOR UPDATE
        `,
        [cartId]
      );

      if (!cartItems.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "Cart is empty",
        });
      }

      const pricedItems = [];

      for (const item of cartItems) {
        const quantity = Number(item.quantity || 0);
        const stockQty = Number(item.stock_qty || 0);

        if (!Number.isInteger(quantity) || quantity <= 0) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            success: false,
            message: `${item.product_name} has an invalid cart quantity`,
            product_id: item.product_id,
          });
        }

        if (quantity > stockQty) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(409).json({
            success: false,
            message: `${item.product_name} has only ${stockQty} available in stock`,
            product_id: item.product_id,
            available_qty: stockQty,
          });
        }

        /*
         * Recalculate every price at checkout.
         * This prevents stale or manipulated prices.
         */
        const unitPrice = await getProductUnitPrice(
          connection,
          item.product_id,
          quantity
        );

        if (unitPrice === null) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            success: false,
            message: `A valid price is not available for ${item.product_name}`,
            product_id: item.product_id,
          });
        }

        pricedItems.push({
          ...item,
          quantity,
          unit_price: unitPrice,
          line_total: Number((quantity * unitPrice).toFixed(2)),
        });
      }

      const subtotal = Number(
        pricedItems
          .reduce((sum, item) => sum + item.line_total, 0)
          .toFixed(2)
      );

      /*
       * Your current checkout rule:
       * minimum order £20 excluding VAT.
       */
      if (subtotal < 20) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "The minimum order value is £20 excluding VAT",
          minimum_order: 20,
          subtotal,
        });
      }

      const discountPercent = Number(cartRows[0].discount_percent || 0);

        const discountAmount = Number(
          (subtotal * discountPercent / 100).toFixed(2)
        );

        const taxableTotal = Number(
          (subtotal - discountAmount).toFixed(2)
        );

        const deliveryCharge = taxableTotal >= 40 ? 0 : 5.95;

        const vatAmount = Number(
          (taxableTotal * 0.2).toFixed(2)
        );

        const totalAmount = Number(
          (taxableTotal + vatAmount + deliveryCharge).toFixed(2)
        );

      const orderRequestNumber = `SOR-${Date.now()}`;

      const [orderResult] = await connection.query(
        `
        INSERT INTO order_requests
          (
            order_request_number,
            user_id,
            cart_id,
            subtotal,
            taxable_total,
            delivery_charge,
            vat_amount,
            total_amount,
            voucher_code,
            discount_percent,
            discount_amount,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUEST_SUBMITTED')
        `,
        [
          orderRequestNumber,
          userId,
          cartId,
          subtotal,
          taxableTotal,
          deliveryCharge,
          vatAmount,
          totalAmount,
          cartRows[0].voucher_code,
          discountPercent,
          discountAmount,
        ]
      );

      const orderRequestId = orderResult.insertId;
      if (cartRows[0].voucher_code) {
      
        // Mark voucher as redeemed
        await connection.query(
          `
          UPDATE subscriptions
          SET redeemed_order_id = ?
          WHERE LOWER(email) = LOWER(?)
            AND UPPER(offer_code) = UPPER(?)
            AND redeemed_order_id IS NULL
          `,
          [
            orderRequestId,
            req.user.email,
            cartRows[0].voucher_code,
          ]
        );
      }

      for (const item of pricedItems) {
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
            orderRequestId,
            item.product_id,
            item.product_name,
            item.sku,
            item.quantity,
            item.unit_price,
            item.line_total,
          ]
        );

        /*
         * Atomic stock reduction.
         * The WHERE condition prevents stock from becoming negative.
         */
        const [stockUpdateResult] = await connection.query(
          `
          UPDATE products
          SET stock_qty = stock_qty - ?
          WHERE product_id = ?
            AND stock_qty >= ?
          `,
          [item.quantity, item.product_id, item.quantity]
        );

        if (stockUpdateResult.affectedRows === 0) {
          const stockError = new Error(
            `${item.product_name} does not have enough stock`
          );

          stockError.code = "INSUFFICIENT_STOCK";
          stockError.productId = item.product_id;

          throw stockError;
        }
      }

      await connection.query(
        `
        UPDATE carts
        SET status = 'ORDERED'
        WHERE cart_id = ?
          AND user_id = ?
          AND status = 'ACTIVE'
        `,
        [cartId, userId]
      );

      await connection.commit();
      transactionStarted = false;

      /*
       * Send emails only after the database transaction succeeds.
       * Email failure will not undo a successfully submitted order.
       */
      try {
        const [userRows] = await db.query(
          `
          SELECT first_name, last_name, email, phone
          FROM users
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

        const user = userRows[0];

        const customerName = `${user?.first_name || ""} ${
          user?.last_name || ""
        }`.trim();

        const emailJobs = [];

        if (user?.email) {
          emailJobs.push(
            sendOrderRequestEmail({
              email: user.email,
              customerName,
              customerPhone: user.phone,
              orderRequestNumber,
              subtotal,
              discountAmount,
              taxableTotal,
              deliveryCharge,
              vatAmount,
              totalAmount,
              items: pricedItems,
            })
          );
        }

        if (process.env.HOST_EMAIL) {
          emailJobs.push(
            sendOrderRequestEmail({
              email: process.env.HOST_EMAIL,
              customerName,
              customerPhone: user?.phone,
              orderRequestNumber,
              subtotal,
              discountAmount,
              taxableTotal,
              deliveryCharge,
              vatAmount,
              totalAmount,
              items: pricedItems,
            })
          );
        }

        const emailResults = await Promise.allSettled(emailJobs);

        emailResults.forEach((result) => {
          if (result.status === "rejected") {
            console.error("Order request email error:", result.reason);
          }
        });
      } catch (emailError) {
        console.error("Order email processing error:", emailError);
      }

      return res.status(201).json({
        success: true,
        order_request_id: orderRequestId,
        order_request_number: orderRequestNumber,
        subtotal,
        discount_amount: discountAmount,
        taxable_total: taxableTotal,
        delivery_charge: deliveryCharge,
        vat_amount: vatAmount,
        total_amount: totalAmount,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Order rollback error:", rollbackError);
        }
      }

      console.error("Request order error:", error);

      if (error.code === "INSUFFICIENT_STOCK") {
        return res.status(409).json({
          success: false,
          message: "One or more products no longer have enough stock",
          product_id: error.productId,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit order request",
      });
    } finally {
      connection.release();
    }
  }
);

router.post("/redeem-voucher",requireAuth, async (req, res) => {
  try {
    const voucherCode = String(req.body.voucherCode || "")
      .trim()
      .toUpperCase();

    if (!voucherCode) {
      return res.status(400).json({
        message: "Please enter a voucher code.",
      });
    }

    const userEmail = req.user?.email;

    if (!userEmail) {
      return res.status(401).json({
        message: "Please log in to redeem this voucher.",
      });
    }

    const [subscriptions] = await db.query(
      `
        SELECT subscription_id, offer_code, redeemed_order_id
        FROM subscriptions
        WHERE LOWER(email) = LOWER(?)
          AND UPPER(offer_code) = UPPER(?)
        LIMIT 1
      `,
      [userEmail, voucherCode]
    );

    if (!subscriptions.length) {
      return res.status(400).json({
        message: "This voucher is not valid for your email address.",
      });
    }

    const subscription = subscriptions[0];

    if (subscription.redeemed_order_id) {
      return res.status(400).json({
        message: "This voucher has already been used.",
      });
    }

    const [carts] = await db.query(
      `
        SELECT cart_id
        FROM carts
        WHERE user_id = ?
        AND status = 'ACTIVE'
        LIMIT 1
      `,
      [req.user.user_id]
    );

    if (!carts.length) {
      return res.status(404).json({
        message: "Cart not found.",
      });
    }

    await db.query(
      `
        UPDATE carts
        SET voucher_code = ?,
            discount_percent = ?
        WHERE cart_id = ?
      `,
      [voucherCode, 10, carts[0].cart_id]
    );

    return res.status(200).json({
      success: true,
      message: "Voucher applied successfully.",
    });
  } catch (error) {
    console.error("Redeem voucher error:", error);

    return res.status(500).json({
      message: "Unable to redeem voucher. Please try again.",
    });
  }
});
module.exports = router;