const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require("multer");
const path = require("path");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

// image upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/products");
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

const attachPrices = async (products) => {
  if (!products.length) return products;

  const productIds = products.map((p) => p.product_id);

  const [prices] = await db.query(
    `
    SELECT
      price_id,
      product_id,
      min_qty,
      max_qty,
      price
    FROM product_prices
    WHERE product_id IN (?)
    ORDER BY product_id, min_qty
    `,
    [productIds]
  );

  return products.map((product) => ({
    ...product,
    price_breaks: prices.filter(
      (price) => price.product_id === product.product_id
    ),
  }));
};

const parsePriceBreaks = (priceBreaksRaw) => {
  try {
    const priceBreaks =
      typeof priceBreaksRaw === "string"
        ? JSON.parse(priceBreaksRaw || "[]")
        : priceBreaksRaw || [];

    if (!Array.isArray(priceBreaks)) return [];

    return priceBreaks
      .filter((item) => item.min_qty && item.price)
      .map((item) => ({
        min_qty: Number(item.min_qty),
        max_qty: item.max_qty ? Number(item.max_qty) : null,
        price: Number(item.price),
      }));
  } catch {
    return [];
  }
};

// GET all products
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.*,
        c.category_name,
        c.slug AS category_slug,
        pi.image_url
      FROM products p
      INNER JOIN categories c
        ON c.category_id = p.category_id
      LEFT JOIN product_images pi
        ON pi.product_id = p.product_id
        AND pi.is_main = 1
      WHERE p.is_active = 1
      ORDER BY c.category_name, p.product_name
    `);

    const products = await attachPrices(rows);
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to load products",
    });
  }
});

// GET products by category
router.get("/category/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const [rows] = await db.query(
      `
      SELECT
        p.*,
        c.category_name,
        c.slug AS category_slug,
        pi.image_url
      FROM products p
      INNER JOIN categories c
        ON c.category_id = p.category_id
      LEFT JOIN product_images pi
        ON pi.product_id = p.product_id
        AND pi.is_main = 1
      WHERE c.slug = ?
      AND p.is_active = 1
      ORDER BY p.product_name
      `,
      [slug]
    );

    const products = await attachPrices(rows);
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to load products",
    });
  }
});

// GET single product
router.get("/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const [rows] = await db.query(
      `
      SELECT
        p.*,
        c.category_name,
        c.slug AS category_slug,
        pi.image_url
      FROM products p
      INNER JOIN categories c
        ON c.category_id = p.category_id
      LEFT JOIN product_images pi
        ON pi.product_id = p.product_id
        AND pi.is_main = 1
      WHERE p.slug = ?
      AND p.is_active = 1
      LIMIT 1
      `,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    const [product] = await attachPrices(rows);
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to load product",
    });
  }
});

// ADD product
router.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      category_id,
      sku,
      product_name,
      slug,
      description,
      is_active = 1,
      price_breaks,
    } = req.body;

    if (!category_id || !product_name || !slug) {
      await connection.rollback();
      return res.status(400).json({
        message: "Category, product name and slug are required",
      });
    }

    const parsedPrices = parsePriceBreaks(price_breaks);

    if (!parsedPrices.length) {
      await connection.rollback();
      return res.status(400).json({
        message: "At least one price slab is required",
      });
    }

    const [result] = await connection.query(
      `
      INSERT INTO products
      (
        category_id,
        sku,
        product_name,
        slug,
        description,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        category_id,
        sku || null,
        product_name,
        slug,
        description || null,
        is_active,
      ]
    );

    const product_id = result.insertId;

    for (const price of parsedPrices) {
      await connection.query(
        `
        INSERT INTO product_prices
        (
          product_id,
          min_qty,
          max_qty,
          price
        )
        VALUES (?, ?, ?, ?)
        `,
        [product_id, price.min_qty, price.max_qty, price.price]
      );
    }

    if (req.file) {
      const imageUrl = `/uploads/products/${req.file.filename}`;

      await connection.query(
        `
        INSERT INTO product_images
        (
          product_id,
          image_url,
          alt_text,
          is_main,
          sort_order
        )
        VALUES (?, ?, ?, 1, 0)
        `,
        [product_id, imageUrl, product_name]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Product added successfully",
      product_id,
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Product slug or SKU already exists",
      });
    }

    res.status(500).json({
      message: "Failed to add product",
    });
  } finally {
    connection.release();
  }
});

// EDIT product
router.put(
  "/:product_id",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { product_id } = req.params;

    const {
      category_id,
      sku,
      product_name,
      slug,
      description,
      is_active = 1,
      price_breaks,
    } = req.body;

    if (!category_id || !product_name || !slug) {
      await connection.rollback();
      return res.status(400).json({
        message: "Category, product name and slug are required",
      });
    }

    const parsedPrices = parsePriceBreaks(price_breaks);

    if (!parsedPrices.length) {
      await connection.rollback();
      return res.status(400).json({
        message: "At least one price slab is required",
      });
    }

    await connection.query(
      `
      UPDATE products
      SET
        category_id = ?,
        sku = ?,
        product_name = ?,
        slug = ?,
        description = ?,
        is_active = ?
      WHERE product_id = ?
      `,
      [
        category_id,
        sku || null,
        product_name,
        slug,
        description || null,
        is_active,
        product_id,
      ]
    );

    await connection.query(
      `
      DELETE FROM product_prices
      WHERE product_id = ?
      `,
      [product_id]
    );

    for (const price of parsedPrices) {
      await connection.query(
        `
        INSERT INTO product_prices
        (
          product_id,
          min_qty,
          max_qty,
          price
        )
        VALUES (?, ?, ?, ?)
        `,
        [product_id, price.min_qty, price.max_qty, price.price]
      );
    }

    if (req.file) {
      const imageUrl = `/uploads/products/${req.file.filename}`;

      await connection.query(
        `
        UPDATE product_images
        SET is_main = 0
        WHERE product_id = ?
        `,
        [product_id]
      );

      await connection.query(
        `
        INSERT INTO product_images
        (
          product_id,
          image_url,
          alt_text,
          is_main,
          sort_order
        )
        VALUES (?, ?, ?, 1, 0)
        `,
        [product_id, imageUrl, product_name]
      );
    }

    await connection.commit();

    res.json({
      message: "Product updated successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Product slug or SKU already exists",
      });
    }

    res.status(500).json({
      message: "Failed to update product",
    });
  } finally {
    connection.release();
  }
});

// DELETE product - soft delete
router.delete(
  "/:product_id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
  try {
    const { product_id } = req.params;

    await db.query(
      `
      UPDATE products
      SET is_active = 0
      WHERE product_id = ?
      `,
      [product_id]
    );

    res.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to delete product",
    });
  }
});

module.exports = router;