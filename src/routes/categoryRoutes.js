const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const uploadToSpaces = require("../services/spaces");

// Upload image to memory first, then send to DigitalOcean Spaces
const upload = multer({
  storage: multer.memoryStorage(),
});

// GET active categories - public
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        c.*,
        p.category_name AS parent_category_name
      FROM categories c
      LEFT JOIN categories p
        ON p.category_id = c.parent_category_id
      WHERE c.is_active = 1
      ORDER BY c.category_name
    `);

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET all categories - admin
router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        c.*,
        p.category_name AS parent_category_name
      FROM categories c
      LEFT JOIN categories p
        ON p.category_id = c.parent_category_id
      ORDER BY c.category_name
    `);

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ADD category - admin
router.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        category_name,
        slug,
        parent_category_id,
        meta_title,
        meta_description,
        seo_content,
        is_active = 1,
      } = req.body;

      if (!category_name || !slug) {
        return res.status(400).json({
          message: "Category name and slug are required",
        });
      }

      const imageUrl = req.file
        ? await uploadToSpaces(req.file, "categories")
        : null;

      const [result] = await db.query(
        `
        INSERT INTO categories
        (
          category_name,
          slug,
          parent_category_id,
          image_url,
          meta_title,
          meta_description,
          seo_content,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [category_name, slug, parent_category_id || null, imageUrl, meta_title || null, meta_description || null, seo_content || null,  is_active]
      );

      res.status(201).json({
        message: "Category added successfully",
        category_id: result.insertId,
      });
    } catch (error) {
      console.error(error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "Category slug already exists",
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// EDIT category - admin
router.put(
  "/:category_id",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const { category_id } = req.params;

      const { category_name, slug, parent_category_id, meta_title, meta_description, seo_content, is_active = 1 } = req.body;

      if (!category_name || !slug) {
        return res.status(400).json({
          message: "Category name and slug are required",
        });
      }

      if (Number(parent_category_id) === Number(category_id)) {
        return res.status(400).json({
          message: "Parent category cannot be same category",
        });
      }

      if (req.file) {
        const imageUrl = await uploadToSpaces(req.file, "categories");

        await db.query(
          `
          UPDATE categories
          SET
            category_name = ?,
            slug = ?,
            parent_category_id = ?,
            image_url = ?,
            meta_title =?,
            meta_description=?,
            seo_content = ?,
            is_active = ?
          WHERE category_id = ?
          `,
          [
            category_name,
            slug,
            parent_category_id || null,
            imageUrl,
            meta_title || null,
            meta_description || null,
            seo_content || null,
            is_active,
            category_id,
          ]
        );
      } else {
        await db.query(
          `
          UPDATE categories
          SET
            category_name = ?,
            slug = ?,
            parent_category_id = ?,
            meta_title = ?,
            meta_description = ?,
            seo_content = ?,
            is_active = ?
          WHERE category_id = ?
          `,
          [category_name, slug, parent_category_id || null, meta_title || null,
            meta_description || null, seo_content || null, is_active, category_id]
        );
      }

      res.json({
        message: "Category updated successfully",
      });
    } catch (error) {
      console.error(error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "Category slug already exists",
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// DELETE category - soft delete
router.delete("/:category_id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { category_id } = req.params;

    const [productRows] = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM products
      WHERE category_id = ?
      AND is_active = 1
      `,
      [category_id]
    );

    if (productRows[0].count > 0) {
      return res.status(400).json({
        message: "Cannot delete category with active products",
      });
    }

    await db.query(
      `
      UPDATE categories
      SET is_active = 0
      WHERE category_id = ?
      `,
      [category_id]
    );

    res.json({
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;