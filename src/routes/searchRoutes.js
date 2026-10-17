
const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET /api/search?q=masking&category=13&sort=price_asc
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const category = req.query.category || "";
    const sort = req.query.sort || "relevant";

    if (!q) {
      return res.json({ products: [], categories: [] });
    }

    const like = `%${q}%`;
    const startsWith = `${q}%`;

    const orderOptions = {
      relevant: "p.product_name ASC",
      price_asc: "from_price ASC",
      price_desc: "from_price DESC",
      name_asc: "p.product_name ASC",
    };

    const orderBy =
      orderOptions[sort] || orderOptions.relevant;

    let categoryFilter = "";
    const params = [like];

    if (category) {
      categoryFilter = `
        AND (
          c.category_id = ?
          OR parent.category_id = ?
        )
      `;
      params.push(category, category);
    }

    // Search main products only
    let [products] = await db.query(
      `
      SELECT
        p.product_id,
        p.product_name,
        p.slug,
        p.description,
        p.brand,
        p.category_id,
        c.category_name,
        parent.category_name AS parent_category_name,

        (
          SELECT i.image_url
          FROM product_main_images i
          WHERE i.product_id = p.product_id
          ORDER BY i.is_primary DESC, i.sort_order ASC
          LIMIT 1
        ) AS image_url,

        (
          SELECT MIN(v.tier_1_price)
          FROM product_variants v
          WHERE v.product_id = p.product_id
            AND v.is_active = 1
        ) AS from_price
        ,
        (
          SELECT COALESCE(SUM(v.stock_qty), 0)
          FROM product_variants v
          WHERE v.product_id = p.product_id
            AND v.is_active = 1
        ) AS stock_qty

      FROM product_main p

      LEFT JOIN categories c
        ON c.category_id = p.category_id

      LEFT JOIN categories parent
        ON parent.category_id = c.parent_category_id

      WHERE p.is_active = 1
        AND p.product_name LIKE ?
        ${categoryFilter}

      ORDER BY ${orderBy}
      LIMIT 100
      `,
      params
    );

    // Fetch product specifications
    const productIds = products.map(p => p.product_id);

    if (productIds.length > 0) {
      const [specRows] = await db.query(
        `
        SELECT
          product_id,
          spec_name,
          spec_value,
          sort_order
        FROM product_main_specs
        WHERE product_id IN (?)
        ORDER BY sort_order ASC
        `,
        [productIds]
      );

      const specsByProduct = {};

      specRows.forEach(spec => {
        if (!specsByProduct[spec.product_id]) {
          specsByProduct[spec.product_id] = [];
        }

        specsByProduct[spec.product_id].push({
          spec_name: spec.spec_name,
          spec_value: spec.spec_value,
          sort_order: spec.sort_order,
        });
      });

      products = products.map(product => ({
        ...product,
        specifications:
          specsByProduct[product.product_id] || [],
      }));
    }

    // Category facet counts
    const [categories] = await db.query(
      `
      SELECT
        c.category_id,
        c.category_name,
        COUNT(p.product_id) AS total
      FROM product_main p
      LEFT JOIN categories c
        ON c.category_id = p.category_id
      WHERE p.is_active = 1
        AND p.product_name LIKE ?
      GROUP BY c.category_id, c.category_name
      ORDER BY total DESC
      `,
      [like]
    );

    return res.json({ products, categories });

  } catch (err) {
    console.error("Search error:", err);

    return res.status(500).json({
      message: "Search failed"
    });
  }
});

// GET /api/search/keywords?q=mask
router.get("/keywords", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (q.length < 2) {
      return res.json([]);
    }

    const [rows] = await db.query(
      `
      SELECT DISTINCT
        product_name AS keyword,
        1 AS main_priority
      FROM product_main
      WHERE is_active = 1
        AND product_name LIKE ?
      ORDER BY product_name ASC
      LIMIT 12
      `,
      [`%${q}%`]
    );

    return res.json(rows);

  } catch (err) {
    console.error("Keyword search error:", err);
    return res.status(500).json([]);
  }
});

module.exports = router;
