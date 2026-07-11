const express = require("express");
const router = express.Router();
const { SitemapStream, streamToPromise } = require("sitemap");
const db = require("../config/db"); // Assumes this is a mysql2 connection pool

router.get("/sitemap.xml", async (req, res) => {
  try {
    const smStream = new SitemapStream({
      hostname: "https://www.sarawholesale.co.uk",
    });

    // Set headers immediately to allow streaming data to the client if needed, 
    // though streamToPromise will buffer it once safely before sending.
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");

    // 1. Static pages
    smStream.write({ url: "/", changefreq: "daily", priority: 1.0 });
    smStream.write({ url: "/products", changefreq: "daily", priority: 0.9 });

    // 2. Stream Categories
    const categoryStream = db.connection
      ? db.query("SELECT slug, parent_category_id, updated_at FROM categories WHERE is_active = 1").stream()
      : db.pool.query("SELECT slug, parent_category_id, updated_at FROM categories WHERE is_active = 1").stream(); 
      // Note: Adjust the `.stream()` target depending on how your db object is exported.
      // If using mysql2/promise pool, use: dynamic streaming via connection wrapper.

    // If using standard mysql2/promise pool wrapper, an async loop is safer and cleaner:
    const [categories] = await db.query("SELECT slug, parent_category_id, updated_at FROM categories WHERE is_active = 1");
    for (const cat of categories) {
      smStream.write({
        url: cat.parent_category_id ? `/subcategory/${cat.slug}` : `/category/${cat.slug}`,
        lastmod: cat.updated_at || new Date(),
        changefreq: "weekly",
        priority: 0.8,
      });
    }

    // 3. Stream Products (Crucial for large datasets)
    // To avoid loading 10k+ rows into arrays, use a cursor/stream if your driver supports it,
    // or batch them if it's a promise pool. 
    // Here is the high-performance connection stream approach:
    const connection = await db.getConnection();
    try {
      const productStream = connection.connection.query(
        "SELECT slug, created_at FROM products WHERE is_active = 1"
      ).stream();

      for await (const product of productStream) {
        smStream.write({
          url: `/product/${product.slug}`,
          lastmod: product.created_at,
          changefreq: "weekly",
          priority: 0.7,
        });
      }
    } finally {
      connection.release(); // Always release connection back to pool
    }

    smStream.end();

    const sitemap = await streamToPromise(smStream);
    res.send(sitemap.toString());

  } catch (error) {
    console.error("Sitemap Error:", error);
    // If headers haven't been sent yet, send a 500 error
    if (!res.headersSent) {
      res.status(500).send("Sitemap Error");
    }
  }
});

module.exports = router;