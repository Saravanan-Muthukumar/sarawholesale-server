const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET /api/search?q=tape&category=13&sort=price_asc
router.get("/", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const category = req.query.category || "";
    const sort = req.query.sort || "relevant";

    if (!q) return res.json({ products: [], categories: [] });

    let orderBy = "score DESC, p.product_name ASC";
    if (sort === "price_asc") orderBy = "from_price ASC";
    if (sort === "price_desc") orderBy = "from_price DESC";
    if (sort === "name_asc") orderBy = "p.product_name ASC";

    // Setup SQL parameters: We need one 'q' for the SELECT score, 
    // one for the WHERE clause score, and two for the LIKE conditions.
    const params = [q, q, `%${q}%`, `%${q}%`];

    let categoryFilter = "";
    if (category) {
      categoryFilter = `
        AND (
          c.category_id = ?
          OR parent.category_id = ?
        )
      `;
      params.push(category, category);
    }

    let [products] = await db.query(
      `
      SELECT
        p.product_id,
        p.product_name,
        p.slug,
        p.sku,
        p.stock_qty,
        c.category_id,
        c.category_name,
        parent.category_name AS parent_category_name,

        (
          SELECT image_url
          FROM product_images
          WHERE product_id = p.product_id
          ORDER BY is_main DESC, sort_order ASC
          LIMIT 1
        ) AS image_url,

        (
          SELECT MIN(price)
          FROM product_prices
          WHERE product_id = p.product_id
        ) AS from_price,

        MATCH(p.product_name, p.sku, p.description)
        AGAINST(? IN NATURAL LANGUAGE MODE) AS score

      FROM products p

      LEFT JOIN categories c
        ON c.category_id = p.category_id

      LEFT JOIN categories parent
        ON parent.category_id = c.parent_category_id

      WHERE
        p.is_active = 1
        AND (
          MATCH(p.product_name, p.sku, p.description)
          AGAINST(? IN NATURAL LANGUAGE MODE)

          OR p.product_name LIKE ?
          OR p.sku LIKE ?
        )

        ${categoryFilter}

      ORDER BY ${orderBy}
      LIMIT 100
      `,
      params
    );

    // Fetch and append product specifications
    const productIds = products.map((p) => p.product_id);
    if (productIds.length > 0) {
      const [specRows] = await db.query(
        `
        SELECT product_id, spec_name, spec_value, sort_order
        FROM product_specifications
        WHERE product_id IN (?)
        ORDER BY sort_order ASC
        `,
        [productIds]
      );

      const specsByProduct = {};
      specRows.forEach((spec) => {
        if (!specsByProduct[spec.product_id]) {
          specsByProduct[spec.product_id] = [];
        }
        specsByProduct[spec.product_id].push({
          spec_name: spec.spec_name,
          spec_value: spec.spec_value,
          sort_order: spec.sort_order,
        });
      });

      products = products.map((product) => ({
        ...product,
        specifications: specsByProduct[product.product_id] || [],
      }));
    }

    // Fetch matching category facet counts
    const [categories] = await db.query(
      `
      SELECT
        c.category_id,
        c.category_name,
        COUNT(p.product_id) AS total
      FROM products p
      LEFT JOIN categories c ON c.category_id = p.category_id
      WHERE
        p.is_active = 1
        AND (
          MATCH(p.product_name, p.sku, p.description)
          AGAINST(? IN NATURAL LANGUAGE MODE)
          OR p.product_name LIKE ?
          OR p.sku LIKE ?
        )
      GROUP BY c.category_id, c.category_name
      ORDER BY total DESC
      `,
      [q, `%${q}%`, `%${q}%`]
    );

    res.json({ products, categories });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: "Search failed" });
  }
});

// GET /api/search/keywords?q=ta
// Consolidates your duplicate endpoints into a single, high-performance clean keyword suggester
router.get("/keywords", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (q.length < 2) {
      return res.json([]);
    }

    const like = `%${q}%`;

    const [rows] = await db.query(
      `
      SELECT keyword, MIN(priority) as main_priority
      FROM (
        /* 1. Category matches get highest priority */
        SELECT DISTINCT
          c.category_name AS keyword,
          1 AS priority
        FROM categories c
        WHERE c.category_name LIKE ?

        UNION

        /* 2. Parent category name fallback matches */
        SELECT DISTINCT
          parent.category_name AS keyword,
          2 AS priority
        FROM categories child
        JOIN categories parent
          ON parent.category_id = child.parent_category_id
        WHERE parent.category_name LIKE ?

        UNION

        /* 3. Cleaned up product names (removes measurement details for broader tags) */
        SELECT DISTINCT
          TRIM(
            REGEXP_REPLACE(
              p.product_name,
              '([0-9]+(mm|cm|m|inch|")([ ]*)x([ ]*)[0-9]+(mm|cm|m|inch|")?|[0-9]+(mm|cm|m|inch|"))',
              ''
            )
          ) AS keyword,
          3 AS priority
        FROM products p
        WHERE p.is_active = 1
          AND p.product_name LIKE ?
      ) AS words
      WHERE keyword IS NOT NULL 
        AND keyword != '' 
        AND CHAR_LENGTH(keyword) > 2
      GROUP BY keyword
      ORDER BY main_priority ASC, keyword ASC
      LIMIT 12
      `,
      [like, like, like]
    );

    res.json(rows);
  } catch (err) {
    console.error("Keyword search error:", err);
    res.status(500).json([]);
  }
});

module.exports = router;