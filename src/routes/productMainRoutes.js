const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const uploadToSpaces = require("../services/spaces");


const upload = multer({ storage: multer.memoryStorage() });
const uploadProductFiles = upload.any();

const parseSpecifications = (raw) => {
  try {
    const specs = typeof raw === "string" ? JSON.parse(raw || "[]") : raw || [];
    if (!Array.isArray(specs)) return [];

    return specs
      .filter((item) => item.spec_name && item.spec_value)
      .map((item, index) => ({
        spec_name: String(item.spec_name).trim(),
        spec_value: String(item.spec_value).trim(),
        sort_order: Number(item.sort_order ?? index),
        is_visible: Number(item.is_visible) === 0 ? 0 : 1,
      }));
  } catch {
    return [];
  }
};

const nullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const parseVariants = (raw) => {
  try {
    const variants = typeof raw === "string" ? JSON.parse(raw || "[]") : raw || [];
    if (!Array.isArray(variants)) return [];

    return variants.map((variant) => ({
      variant_id: variant.variant_id ? Number(variant.variant_id) : null,
      sku: String(variant.sku || "").trim(),
      variant_1: String(variant.variant_1 || "").trim() || null,
      variant_1_value: String(variant.variant_1_value || "").trim() || null,
      variant_2: String(variant.variant_2 || "").trim() || null,
      variant_2_value: String(variant.variant_2_value || "").trim() || null,
      stock_qty: Number(variant.stock_qty || 0),
      tier_1_qty: Number(variant.tier_1_qty || 1),
      tier_1_price: Number(variant.tier_1_price || 0),
      tier_2_qty: nullableNumber(variant.tier_2_qty),
      tier_2_price: nullableNumber(variant.tier_2_price),
      tier_3_qty: nullableNumber(variant.tier_3_qty),
      tier_3_price: nullableNumber(variant.tier_3_price),
      tier_4_qty: nullableNumber(variant.tier_4_qty),
      tier_4_price: nullableNumber(variant.tier_4_price),
      is_active: Number(variant.is_active) === 0 ? 0 : 1,
    }));
  } catch (error) {
    console.error("Parse variants error:", error);
    return [];
  }
};

const attachImagesAndSpecs = async (products) => {
  if (!products.length) return products;

  const productIds = products.map((p) => p.product_id);

  const [images] = await db.query(
    `SELECT image_id, product_id, image_url, alt_text, is_primary, sort_order
     FROM product_main_images
     WHERE product_id IN (?)
     ORDER BY product_id, is_primary DESC, sort_order, image_id`,
    [productIds]
  );

  const [specs] = await db.query(
    `SELECT spec_id, product_id, spec_name, spec_value, sort_order, is_visible
     FROM product_main_specs
     WHERE product_id IN (?)
     ORDER BY product_id, sort_order, spec_id`,
    [productIds]
  );

  return products.map((product) => {
    const productImages = images.filter(
      (image) => Number(image.product_id) === Number(product.product_id)
    );

    return {
      ...product,
      images: productImages,
      image_url: productImages[0]?.image_url || product.image_url || null,
      specifications: specs.filter(
        (spec) => Number(spec.product_id) === Number(product.product_id)
      ),
    };
  });
};

const attachVariants = async (product) => {
  const [variants] = await db.query(
    `SELECT *
     FROM product_variants
     WHERE product_id = ?
     ORDER BY variant_1_value, variant_2_value, variant_id`,
    [product.product_id]
  );

  if (!variants.length) return { ...product, variants: [] };

  const variantIds = variants.map((variant) => variant.variant_id);

  const [images] = await db.query(
    `SELECT image_id, variant_id, image_url, alt_text, is_primary, sort_order
     FROM product_variant_images
     WHERE variant_id IN (?)
     ORDER BY variant_id, is_primary DESC, sort_order, image_id`,
    [variantIds]
  );

  return {
    ...product,
    variants: variants.map((variant) => {
      const variantImages = images.filter(
        (image) => Number(image.variant_id) === Number(variant.variant_id)
      );

      return {
        ...variant,
        stock_qty: Number(variant.stock_qty || 0),
        tier_1_qty: Number(variant.tier_1_qty || 1),
        tier_1_price: Number(variant.tier_1_price || 0),
        tier_2_qty: variant.tier_2_qty === null ? null : Number(variant.tier_2_qty),
        tier_2_price: variant.tier_2_price === null ? null : Number(variant.tier_2_price),
        tier_3_qty: variant.tier_3_qty === null ? null : Number(variant.tier_3_qty),
        tier_3_price: variant.tier_3_price === null ? null : Number(variant.tier_3_price),
        tier_4_qty: variant.tier_4_qty === null ? null : Number(variant.tier_4_qty),
        tier_4_price: variant.tier_4_price === null ? null : Number(variant.tier_4_price),
        images: variantImages,
        image_url: variantImages[0]?.image_url || null,
      };
    }),
  };
};

const insertSpecifications = async (connection, productId, specifications) => {
  for (const spec of specifications) {
    await connection.query(
      `INSERT INTO product_main_specs
       (product_id, spec_name, spec_value, sort_order, is_visible)
       VALUES (?, ?, ?, ?, ?)`,
      [
        productId,
        spec.spec_name,
        spec.spec_value,
        spec.sort_order,
        spec.is_visible,
      ]
    );
  }
};

const uploadMainImages = async (
  connection,
  productId,
  productName,
  files,
  makeFirstPrimary = false
) => {
  if (!files?.length) return;

  const [countRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM product_main_images
     WHERE product_id = ?`,
    [productId]
  );

  const existingCount = Number(countRows[0].total || 0);

  for (let index = 0; index < files.length; index++) {
    const imageUrl = await uploadToSpaces(files[index], "product-main");
    const isPrimary =
      (makeFirstPrimary && index === 0) ||
      (existingCount === 0 && index === 0)
        ? 1
        : 0;

    await connection.query(
      `INSERT INTO product_main_images
       (product_id, image_url, alt_text, is_primary, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [
        productId,
        imageUrl,
        productName,
        isPrimary,
        existingCount + index,
      ]
    );
  }
};

const uploadVariantImages = async (
  connection,
  variantId,
  productName,
  files
) => {
  if (!files?.length) return;

  const [countRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM product_variant_images
     WHERE variant_id = ?`,
    [variantId]
  );

  const existingCount = Number(countRows[0].total || 0);

  for (let index = 0; index < files.length; index += 1) {
    const imageUrl = await uploadToSpaces(files[index], "product-variants");
    const isPrimary = existingCount === 0 && index === 0 ? 1 : 0;

    await connection.query(
      `INSERT INTO product_variant_images
       (variant_id, image_url, alt_text, is_primary, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [variantId, imageUrl, productName, isPrimary, existingCount + index]
    );
  }
};

const saveVariants = async (
  connection,
  productId,
  productName,
  variants,
  uploadedFiles
) => {
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];

    if (!variant.sku) {
      throw new Error(`SKU is required for variant ${index + 1}`);
    }

    let variantId = variant.variant_id;

    if (variantId) {
      const [result] = await connection.query(
        `UPDATE product_variants
         SET sku = ?, variant_1 = ?, variant_1_value = ?,
             variant_2 = ?, variant_2_value = ?, stock_qty = ?,
             tier_1_qty = ?, tier_1_price = ?,
             tier_2_qty = ?, tier_2_price = ?,
             tier_3_qty = ?, tier_3_price = ?,
             tier_4_qty = ?, tier_4_price = ?, is_active = ?
         WHERE variant_id = ? AND product_id = ?`,
        [
          variant.sku,
          variant.variant_1,
          variant.variant_1_value,
          variant.variant_2,
          variant.variant_2_value,
          variant.stock_qty,
          variant.tier_1_qty,
          variant.tier_1_price,
          variant.tier_2_qty,
          variant.tier_2_price,
          variant.tier_3_qty,
          variant.tier_3_price,
          variant.tier_4_qty,
          variant.tier_4_price,
          variant.is_active,
          variantId,
          productId,
        ]
      );

      if (!result.affectedRows) {
        throw new Error(`Variant ${index + 1} was not found`);
      }
    } else {
      const [result] = await connection.query(
        `INSERT INTO product_variants
         (product_id, sku, variant_1, variant_1_value,
          variant_2, variant_2_value, stock_qty,
          tier_1_qty, tier_1_price,
          tier_2_qty, tier_2_price,
          tier_3_qty, tier_3_price,
          tier_4_qty, tier_4_price, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId,
          variant.sku,
          variant.variant_1,
          variant.variant_1_value,
          variant.variant_2,
          variant.variant_2_value,
          variant.stock_qty,
          variant.tier_1_qty,
          variant.tier_1_price,
          variant.tier_2_qty,
          variant.tier_2_price,
          variant.tier_3_qty,
          variant.tier_3_price,
          variant.tier_4_qty,
          variant.tier_4_price,
          variant.is_active,
        ]
      );

      variantId = result.insertId;
    }

    const variantFiles = (uploadedFiles || []).filter(
      (file) => file.fieldname === `variant_images_${index}`
    );

    await uploadVariantImages(
      connection,
      variantId,
      productName,
      variantFiles
    );
  }
};

// GET all product_main rows for admin/list page
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        pm.*,
        c.category_name,
        c.slug AS category_slug,
        MIN(CASE WHEN pv.is_active = 1 THEN pv.tier_1_price END) AS lowest_price,
        SUM(CASE WHEN pv.is_active = 1 THEN pv.stock_qty ELSE 0 END) AS total_stock,
        COUNT(CASE WHEN pv.is_active = 1 THEN pv.variant_id END) AS variant_count
      FROM product_main pm
      INNER JOIN categories c ON c.category_id = pm.category_id
      LEFT JOIN product_variants pv ON pv.product_id = pm.product_id
      GROUP BY pm.product_id
      ORDER BY c.category_name, pm.product_name
    `);

    const products = await attachImagesAndSpecs(rows);
    res.json(products);
  } catch (error) {
    console.error("Load product_main error:", error);
    res.status(500).json({ message: "Failed to load products" });
  }
});

// GET products by category
router.get("/category/:slug", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         pm.*,
         c.category_name,
         c.slug AS category_slug,
         MIN(CASE WHEN pv.is_active = 1 THEN pv.tier_1_price END) AS lowest_price,
         SUM(CASE WHEN pv.is_active = 1 THEN pv.stock_qty ELSE 0 END) AS total_stock,
         COUNT(CASE WHEN pv.is_active = 1 THEN pv.variant_id END) AS variant_count
       FROM product_main pm
       INNER JOIN categories c ON c.category_id = pm.category_id
       LEFT JOIN product_variants pv ON pv.product_id = pm.product_id
       WHERE c.slug = ? AND pm.is_active = 1
       GROUP BY pm.product_id
       ORDER BY pm.product_name`,
      [req.params.slug]
    );

    const products = await attachImagesAndSpecs(rows);
    res.json(products);
  } catch (error) {
    console.error("Load category products error:", error);
    res.status(500).json({ message: "Failed to load category products" });
  }
});

// GET product by ID for admin edit modal
router.get("/id/:product_id", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pm.*, c.category_name, c.slug AS category_slug
       FROM product_main pm
       INNER JOIN categories c ON c.category_id = pm.category_id
       WHERE pm.product_id = ?
       LIMIT 1`,
      [req.params.product_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [product] = await attachImagesAndSpecs(rows);
    const fullProduct = await attachVariants(product);
    res.json(fullProduct);
  } catch (error) {
    console.error("Load product by ID error:", error);
    res.status(500).json({ message: "Failed to load product" });
  }
});

// ADD main product
router.post(
  "/",
  requireAuth,
  requireAdmin,
  uploadProductFiles,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const {
        category_id,
        product_name,
        slug,
        brand,
        model,
        size,
        description,
        vat_rate = 20,
        is_active = 1,
        meta_title,
        meta_description,
        seo_content,
        specifications,
        variants,
      } = req.body;

      if (!category_id || !product_name || !slug) {
        await connection.rollback();
        return res.status(400).json({
          message: "Category, product name and slug are required",
        });
      }

      const parsedSpecs = parseSpecifications(specifications);
      const parsedVariants = parseVariants(variants);

      if (!parsedVariants.length) {
        await connection.rollback();
        return res.status(400).json({ message: "Add at least one variant" });
      }

      const [result] = await connection.query(
        `INSERT INTO product_main
         (category_id, product_name, slug, brand, model, size, description,
          vat_rate, is_active, meta_title, meta_description, seo_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          category_id,
          product_name,
          String(slug).trim().toLowerCase(),
          brand || null,
          model || null,
          size || null,
          description || null,
          Number(vat_rate),
          Number(is_active) === 0 ? 0 : 1,
          meta_title || null,
          meta_description || null,
          seo_content || null,
        ]
      );

      const productId = result.insertId;

      await insertSpecifications(connection, productId, parsedSpecs);

      const mainImageFiles = (req.files || []).filter(
        (file) => file.fieldname === "product_images"
      );
      
      await uploadMainImages(
        connection,
        productId,
        product_name,
        mainImageFiles,
        true
      );

      await saveVariants(
        connection,
        productId,
        product_name,
        parsedVariants,
        req.files
      );

      await connection.commit();

      res.status(201).json({
        message: "Product added successfully",
        product_id: productId,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Add product_main error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "Product slug already exists" });
      }

      res.status(500).json({ message: "Failed to add product" });
    } finally {
      connection.release();
    }
  }
);

// SET primary main image
router.put(
  "/image/:image_id/primary",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT product_id
         FROM product_main_images
         WHERE image_id = ?
         LIMIT 1`,
        [req.params.image_id]
      );

      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ message: "Image not found" });
      }

      const productId = rows[0].product_id;

      await connection.query(
        `UPDATE product_main_images
         SET is_primary = 0
         WHERE product_id = ?`,
        [productId]
      );

      await connection.query(
        `UPDATE product_main_images
         SET is_primary = 1
         WHERE image_id = ?`,
        [req.params.image_id]
      );

      await connection.commit();
      res.json({ message: "Main image updated" });
    } catch (error) {
      await connection.rollback();
      console.error("Set main image error:", error);
      res.status(500).json({ message: "Failed to update main image" });
    } finally {
      connection.release();
    }
  }
);

// UPDATE main image order
router.put("/image/order", requireAuth, requireAdmin, async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { product_id, images } = req.body;

    if (!product_id || !Array.isArray(images)) {
      await connection.rollback();
      return res.status(400).json({
        message: "Product ID and images are required",
      });
    }

    for (const image of images) {
      await connection.query(
        `UPDATE product_main_images
         SET sort_order = ?
         WHERE product_id = ? AND image_id = ?`,
        [Number(image.sort_order || 0), product_id, image.image_id]
      );
    }

    await connection.commit();
    res.json({ message: "Image order updated" });
  } catch (error) {
    await connection.rollback();
    console.error("Update image order error:", error);
    res.status(500).json({ message: "Failed to update image order" });
  } finally {
    connection.release();
  }
});

// DELETE main image
router.delete("/image/:image_id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT product_id, is_primary
       FROM product_main_images
       WHERE image_id = ?
       LIMIT 1`,
      [req.params.image_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Image not found" });
    }

    const deletedImage = rows[0];

    await db.query(
      `DELETE FROM product_main_images WHERE image_id = ?`,
      [req.params.image_id]
    );

    if (Number(deletedImage.is_primary) === 1) {
      const [nextImages] = await db.query(
        `SELECT image_id
         FROM product_main_images
         WHERE product_id = ?
         ORDER BY sort_order, image_id
         LIMIT 1`,
        [deletedImage.product_id]
      );

      if (nextImages.length) {
        await db.query(
          `UPDATE product_main_images
           SET is_primary = 1
           WHERE image_id = ?`,
          [nextImages[0].image_id]
        );
      }
    }

    res.json({ message: "Image deleted" });
  } catch (error) {
    console.error("Delete image error:", error);
    res.status(500).json({ message: "Failed to delete image" });
  }
});

// SET primary variant image
router.put(
  "/variant-image/:image_id/primary",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT variant_id
         FROM product_variant_images
         WHERE image_id = ?
         LIMIT 1`,
        [req.params.image_id]
      );

      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ message: "Variant image not found" });
      }

      const variantId = rows[0].variant_id;

      await connection.query(
        `UPDATE product_variant_images
         SET is_primary = 0
         WHERE variant_id = ?`,
        [variantId]
      );

      await connection.query(
        `UPDATE product_variant_images
         SET is_primary = 1
         WHERE image_id = ?`,
        [req.params.image_id]
      );

      await connection.commit();
      res.json({ message: "Variant image updated" });
    } catch (error) {
      await connection.rollback();
      console.error("Set variant image error:", error);
      res.status(500).json({ message: "Failed to update variant image" });
    } finally {
      connection.release();
    }
  }
);

// DELETE variant image
router.delete(
  "/variant-image/:image_id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT variant_id, is_primary
         FROM product_variant_images
         WHERE image_id = ?
         LIMIT 1`,
        [req.params.image_id]
      );

      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ message: "Variant image not found" });
      }

      const image = rows[0];

      await connection.query(
        `DELETE FROM product_variant_images WHERE image_id = ?`,
        [req.params.image_id]
      );

      if (Number(image.is_primary) === 1) {
        const [nextImages] = await connection.query(
          `SELECT image_id
           FROM product_variant_images
           WHERE variant_id = ?
           ORDER BY sort_order, image_id
           LIMIT 1`,
          [image.variant_id]
        );

        if (nextImages.length) {
          await connection.query(
            `UPDATE product_variant_images
             SET is_primary = 1
             WHERE image_id = ?`,
            [nextImages[0].image_id]
          );
        }
      }

      await connection.commit();
      res.json({ message: "Variant image deleted" });
    } catch (error) {
      await connection.rollback();
      console.error("Delete variant image error:", error);
      res.status(500).json({ message: "Failed to delete variant image" });
    } finally {
      connection.release();
    }
  }
);

// DELETE variant
router.delete(
  "/variant/:variant_id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        `DELETE FROM product_variant_images WHERE variant_id = ?`,
        [req.params.variant_id]
      );

      const [result] = await connection.query(
        `DELETE FROM product_variants WHERE variant_id = ?`,
        [req.params.variant_id]
      );

      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ message: "Variant not found" });
      }

      await connection.commit();
      res.json({ message: "Variant deleted" });
    } catch (error) {
      await connection.rollback();
      console.error("Delete variant error:", error);
      res.status(500).json({ message: "Failed to delete variant" });
    } finally {
      connection.release();
    }
  }
);

// EDIT main product
router.put(
  "/:product_id",
  requireAuth,
  requireAdmin,
  uploadProductFiles,
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const {
        category_id,
        product_name,
        slug,
        brand,
        model,
        size,
        description,
        vat_rate = 20,
        is_active = 1,
        meta_title,
        meta_description,
        seo_content,
        specifications,
        variants,
      } = req.body;

      if (!category_id || !product_name || !slug) {
        await connection.rollback();
        return res.status(400).json({
          message: "Category, product name and slug are required",
        });
      }

      const parsedSpecs = parseSpecifications(specifications);
      const parsedVariants = parseVariants(variants);

      const [result] = await connection.query(
        `UPDATE product_main
         SET category_id = ?, product_name = ?, slug = ?, brand = ?, model = ?,
             size = ?, description = ?, vat_rate = ?, is_active = ?,
             meta_title = ?, meta_description = ?, seo_content = ?
         WHERE product_id = ?`,
        [
          category_id,
          product_name,
          String(slug).trim().toLowerCase(),
          brand || null,
          model || null,
          size || null,
          description || null,
          Number(vat_rate),
          Number(is_active) === 0 ? 0 : 1,
          meta_title || null,
          meta_description || null,
          seo_content || null,
          req.params.product_id,
        ]
      );

      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ message: "Product not found" });
      }

      await connection.query(
        `DELETE FROM product_main_specs WHERE product_id = ?`,
        [req.params.product_id]
      );

      await insertSpecifications(
        connection,
        req.params.product_id,
        parsedSpecs
      );

      const mainImageFiles = (req.files || []).filter(
        (file) => file.fieldname === "product_images"
      );
      
      await uploadMainImages(
        connection,
        req.params.product_id,
        product_name,
        mainImageFiles,
        false
      );

      await saveVariants(
        connection,
        Number(req.params.product_id),
        product_name,
        parsedVariants,
        req.files
      );

      await connection.commit();
      res.json({ message: "Product updated successfully" });
    } catch (error) {
      await connection.rollback();
      console.error("Update product_main error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "Product slug already exists" });
      }

      res.status(500).json({ message: "Failed to update product" });
    } finally {
      connection.release();
    }
  }
);

// SOFT DELETE main product
router.delete("/:product_id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await db.query(
      `UPDATE product_main
       SET is_active = 0
       WHERE product_id = ?`,
      [req.params.product_id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product_main error:", error);
    res.status(500).json({ message: "Failed to delete product" });
  }
});

// GET active product by slug - keep this last
router.get("/:slug", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pm.*, c.category_name, c.slug AS category_slug
       FROM product_main pm
       INNER JOIN categories c ON c.category_id = pm.category_id
       WHERE pm.slug = ? AND pm.is_active = 1
       LIMIT 1`,
      [req.params.slug]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [product] = await attachImagesAndSpecs(rows);
    const fullProduct = await attachVariants(product);
    res.json(fullProduct);
  } catch (error) {
    console.error("Load product by slug error:", error);
    res.status(500).json({ message: "Failed to load product" });
  }
});

module.exports = router;
