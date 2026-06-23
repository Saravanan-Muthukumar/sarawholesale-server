const express = require("express");
const router = express.Router();
const { SitemapStream, streamToPromise } = require("sitemap");
const db = require("../config/db");

router.get("/sitemap.xml", async (req, res) => {
  try {
    const smStream = new SitemapStream({
      hostname: "https://www.sarawholesale.co.uk",
    });

    // Static pages
    smStream.write({ url: "/", changefreq: "daily", priority: 1.0 });
    smStream.write({ url: "/products", changefreq: "daily", priority: 0.9 });

    // Categories
    const [categories] = await db.query(`
      SELECT slug, parent_category_id
      FROM categories
      WHERE is_active = 1
    `);

    categories.forEach((cat) => {
      smStream.write({
        url: cat.parent_category_id
          ? `/subcategory/${cat.slug}`
          : `/category/${cat.slug}`,
        changefreq: "weekly",
        priority: 0.8,
      });
    });

    // Products
    const [products] = await db.query(`
      SELECT slug, created_at
      FROM products
      WHERE is_active = 1
    `);

    products.forEach((product) => {
      smStream.write({
        url: `/product/${product.slug}`,
        lastmod: product.created_at,
        changefreq: "weekly",
        priority: 0.7,
      });
    });

    smStream.end();

    const sitemap = await streamToPromise(smStream);

    res.header("Content-Type", "application/xml");
    res.send(sitemap.toString());
  } catch (error) {
    console.error(error);
    res.status(500).send("Sitemap Error");
  }
});

module.exports = router;