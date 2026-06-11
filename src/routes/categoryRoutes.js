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
    cb(null, "uploads/categories");
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
        is_active = 1,
      } = req.body;

      if (!category_name || !slug) {
        return res.status(400).json({
          message: "Category name and slug are required",
        });
      }

      const imageUrl = req.file
        ? `/uploads/categories/${req.file.filename}`
        : null;

      const [result] = await db.query(
        `
        INSERT INTO categories
        (
          category_name,
          slug,
          parent_category_id,
          image_url,
          is_active
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          category_name,
          slug,
          parent_category_id || null,
          imageUrl,
          is_active,
        ]
      );

      res.status(201).json({
        message: "Category added successfully",
        category_id: result.insertId,
      });
    } catch (error) {
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

      const {
        category_name,
        slug,
        parent_category_id,
        is_active = 1,
      } = req.body;

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

      let imageUrl = null;

      if (req.file) {
        imageUrl = `/uploads/categories/${req.file.filename}`;

        await db.query(
          `
          UPDATE categories
          SET
            category_name = ?,
            slug = ?,
            parent_category_id = ?,
            image_url = ?,
            is_active = ?
          WHERE category_id = ?
          `,
          [
            category_name,
            slug,
            parent_category_id || null,
            imageUrl,
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
            is_active = ?
          WHERE category_id = ?
          `,
          [
            category_name,
            slug,
            parent_category_id || null,
            is_active,
            category_id,
          ]
        );
      }

      res.json({
        message: "Category updated successfully",
      });
    } catch (error) {
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
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;