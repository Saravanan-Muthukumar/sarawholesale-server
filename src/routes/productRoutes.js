const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const uploadToSpaces = require("../services/spaces");

const upload = multer({
  storage: multer.memoryStorage(),
});

const attachPrices = async (products) => {
  if (!products.length) return products;

  const productIds = products.map((p) => p.product_id);

  const [prices] = await db.query(
    `
    SELECT price_id, product_id, min_qty, max_qty, price
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

const attachImagesAndSpecs = async (products) => {
  if (!products.length) return products;

  const productIds = products.map((p) => p.product_id);

  const [images] = await db.query(
    `
    SELECT image_id, product_id, image_url, alt_text, is_main, sort_order
    FROM product_images
    WHERE product_id IN (?)
    ORDER BY product_id, is_main DESC, sort_order ASC, image_id ASC
    `,
    [productIds]
  );

  const [specs] = await db.query(
    `
    SELECT spec_id, product_id, spec_name, spec_value, sort_order
    FROM product_specifications
    WHERE product_id IN (?)
    AND is_visible = 1
    ORDER BY product_id, sort_order ASC, spec_id ASC
    `,
    [productIds]
  );

  return products.map((product) => ({
    ...product,
    images: images.filter((img) => img.product_id === product.product_id),
    specifications: specs.filter(
      (spec) => spec.product_id === product.product_id
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

const parseSpecifications = (specificationsRaw) => {
  try {
    const specs =
      typeof specificationsRaw === "string"
        ? JSON.parse(specificationsRaw || "[]")
        : specificationsRaw || [];

    if (!Array.isArray(specs)) return [];

    return specs
      .filter((item) => item.spec_name && item.spec_value)
      .map((item, index) => ({
        spec_name: String(item.spec_name).trim(),
        spec_value: String(item.spec_value).trim(),
        sort_order: index,
      }));
  } catch {
    return [];
  }
};

const loadFullProducts = async (rows) => {
  const withPrices = await attachPrices(rows);
  return attachImagesAndSpecs(withPrices);
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
      INNER JOIN categories c ON c.category_id = p.category_id
      LEFT JOIN product_images pi
        ON pi.product_id = p.product_id
        AND pi.is_main = 1
      WHERE p.is_active = 1
      ORDER BY c.category_name, p.product_name
    `);

    const products = await loadFullProducts(rows);
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load products" });
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
      INNER JOIN categories c ON c.category_id = p.category_id
      LEFT JOIN product_images pi
        ON pi.product_id = p.product_id
        AND pi.is_main = 1
      WHERE c.slug = ?
      AND p.is_active = 1
      ORDER BY p.product_name
      `,
      [slug]
    );

    const products = await loadFullProducts(rows);
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load products" });
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
      INNER JOIN categories c ON c.category_id = p.category_id
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
      return res.status(404).json({ message: "Product not found" });
    }

    const products = await loadFullProducts(rows);
    res.json(products[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load product" });
  }
});

// ADD product
router.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.array("images", 8),
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
        meta_title,
        meta_description,
        seo_content,
        is_active = 1,
        price_breaks,
        specifications,
        brand,
        model,
        size,
      } = req.body;

      if (!category_id || !product_name || !slug) {
        await connection.rollback();
        return res.status(400).json({
          message: "Category, product name and slug are required",
        });
      }

      const parsedPrices = parsePriceBreaks(price_breaks);
      const parsedSpecs = parseSpecifications(specifications);

      if (!parsedPrices.length) {
        await connection.rollback();
        return res.status(400).json({
          message: "At least one price slab is required",
        });
      }

      const [result] = await connection.query(
        `
        INSERT INTO products
        (category_id, sku, brand, model, size, product_name, slug, description, meta_title, meta_description, seo_content, is_active)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          category_id,
          sku || null,
          brand || null,
          model || null,
          size || null,
          product_name,
          slug,
          description || null,
          meta_title || null,
          meta_description || null,
          seo_content || null,
          is_active,
      ]
      );

      const product_id = result.insertId;

      for (const price of parsedPrices) {
        await connection.query(
          `
          INSERT INTO product_prices
          (product_id, min_qty, max_qty, price)
          VALUES (?, ?, ?, ?)
          `,
          [product_id, price.min_qty, price.max_qty, price.price]
        );
      }

      for (const spec of parsedSpecs) {
        await connection.query(
          `
          INSERT INTO product_specifications
          (product_id, spec_name, spec_value, sort_order)
          VALUES (?, ?, ?, ?)
          `,
          [product_id, spec.spec_name, spec.spec_value, spec.sort_order]
        );
      }

      if (req.files && req.files.length) {
        for (let i = 0; i < req.files.length; i++) {
          const imageUrl = await uploadToSpaces(req.files[i], "products");

          await connection.query(
            `
            INSERT INTO product_images
            (product_id, image_url, alt_text, is_main, sort_order)
            VALUES (?, ?, ?, ?, ?)
            `,
            [product_id, imageUrl, product_name, i === 0 ? 1 : 0, i]
          );
        }
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

      res.status(500).json({ message: "Failed to add product" });
    } finally {
      connection.release();
    }
  }
);

//image/main
router.put(
  "/image/main",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const { product_id, image_id } = req.body;

      await connection.query(
        `UPDATE product_images
         SET is_main = 0
         WHERE product_id = ?`,
        [product_id]
      );

      await connection.query(
        `UPDATE product_images
         SET is_main = 1
         WHERE product_id = ?
         AND image_id = ?`,
        [product_id, image_id]
      );

      await connection.commit();

      res.json({ message: "Main image updated" });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(500).json({ message: "Failed to update main image" });
    } finally {
      connection.release();
    }
  }
);

// UPDATE PRODUCT IMAGE ORDER
router.put(
  "/image/order",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const { product_id, images } = req.body;

      if (!product_id || !Array.isArray(images) || images.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          message: "Product ID and images array are required",
        });
      }

      for (const image of images) {
        if (!image.image_id && image.image_id !== 0) {
          await connection.rollback();
          return res.status(400).json({
            message: "Each image must have image_id",
          });
        }

        await connection.query(
          `
          UPDATE product_images
          SET sort_order = ?
          WHERE product_id = ?
          AND image_id = ?
          `,
          [
            Number(image.sort_order || 0),
            product_id,
            image.image_id,
          ]
        );
      }

      await connection.commit();

      res.json({
        message: "Image order updated successfully",
      });
    } catch (error) {
      await connection.rollback();
      console.error(error);

      res.status(500).json({
        message: "Failed to update image order",
      });
    } finally {
      connection.release();
    }
  }
);

//delete image
router.delete(
  "/image/:image_id",
  requireAuth,
  requireAdmin,
  async(req,res)=>{
  
  const {image_id}=req.params;
  
  await db.query(
  "DELETE FROM product_images WHERE image_id=?",
  [image_id]
  );
  
  res.json({message:"Image deleted"});
  
  });

// EDIT product
router.put(
  "/:product_id",
  requireAuth,
  requireAdmin,
  upload.array("images", 8),
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
        meta_title,
        meta_description,
        seo_content,
        is_active = 1,
        price_breaks,
        specifications,
        brand,
        model,
        size,
      } = req.body;

      if (!category_id || !product_name || !slug) {
        await connection.rollback();
        return res.status(400).json({
          message: "Category, product name and slug are required",
        });
      }

      const parsedPrices = parsePriceBreaks(price_breaks);
      const parsedSpecs = parseSpecifications(specifications);

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
            brand = ?,
            model = ?,
            size = ?,
            product_name = ?,
            slug = ?,
            description = ?,
            meta_title = ?,
            meta_description = ?,
            seo_content = ?,
            is_active = ?
          WHERE product_id = ?
        `,
        [
          
            category_id,
            sku || null,
            brand || null,
            model || null,
            size || null,
            product_name,
            slug,
            description || null,
            meta_title || null,
            meta_description || null,
            seo_content || null,
            is_active,
            product_id,
          
        ]
      );

      await connection.query(
        `DELETE FROM product_prices WHERE product_id = ?`,
        [product_id]
      );

      for (const price of parsedPrices) {
        await connection.query(
          `
          INSERT INTO product_prices
          (product_id, min_qty, max_qty, price)
          VALUES (?, ?, ?, ?)
          `,
          [product_id, price.min_qty, price.max_qty, price.price]
        );
      }

      await connection.query(
        `DELETE FROM product_specifications WHERE product_id = ?`,
        [product_id]
      );

      for (const spec of parsedSpecs) {
        await connection.query(
          `
          INSERT INTO product_specifications
          (product_id, spec_name, spec_value, sort_order)
          VALUES (?, ?, ?, ?)
          `,
          [product_id, spec.spec_name, spec.spec_value, spec.sort_order]
        );
      }

      if (req.files && req.files.length) {
        await connection.query(
          `UPDATE product_images SET is_main = 0 WHERE product_id = ?`,
          [product_id]
        );

        for (let i = 0; i < req.files.length; i++) {
          const imageUrl = await uploadToSpaces(req.files[i], "products");

          await connection.query(
            `
            INSERT INTO product_images
            (product_id, image_url, alt_text, is_main, sort_order)
            VALUES (?, ?, ?, ?, ?)
            `,
            [product_id, imageUrl, product_name, i === 0 ? 1 : 0, i]
          );
        }
      }

      await connection.commit();

      res.json({ message: "Product updated successfully" });
    } catch (error) {
      await connection.rollback();
      console.error(error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "Product slug or SKU already exists",
        });
      }

      res.status(500).json({ message: "Failed to update product" });
    } finally {
      connection.release();
    }
  }
);

// DELETE product - soft delete
router.delete("/:product_id", requireAuth, requireAdmin, async (req, res) => {
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

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete product" });
  }
});




module.exports = router;