require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../src/config/db");
const uploadToSpaces = require("../src/services/spaces");

async function migrateProductImages() {
  const [images] = await db.query(`
    SELECT image_id, image_url
    FROM product_images
    WHERE image_url LIKE '/uploads/products/%'
  `);

  for (const img of images) {
    const fileName = path.basename(img.image_url);
    const localPath = path.join(__dirname, "..", "uploads", "products", fileName);

    if (!fs.existsSync(localPath)) {
      console.log("Missing product image:", localPath);
      continue;
    }

    const fileBuffer = fs.readFileSync(localPath);

    const file = {
      originalname: fileName,
      buffer: fileBuffer,
      mimetype: getMimeType(fileName),
    };

    const newUrl = await uploadToSpaces(file, "products");

    await db.query(
      `
      UPDATE product_images
      SET image_url = ?
      WHERE image_id = ?
      `,
      [newUrl, img.image_id]
    );

    console.log("Migrated product image:", img.image_url, "=>", newUrl);
  }
}

async function migrateCategoryImages() {
  const [categories] = await db.query(`
    SELECT category_id, image_url
    FROM categories
    WHERE image_url LIKE '/uploads/categories/%'
  `);

  for (const cat of categories) {
    const fileName = path.basename(cat.image_url);
    const localPath = path.join(
      __dirname,
      "..",
      "uploads",
      "categories",
      fileName
    );

    if (!fs.existsSync(localPath)) {
      console.log("Missing category image:", localPath);
      continue;
    }

    const fileBuffer = fs.readFileSync(localPath);

    const file = {
      originalname: fileName,
      buffer: fileBuffer,
      mimetype: getMimeType(fileName),
    };

    const newUrl = await uploadToSpaces(file, "categories");

    await db.query(
      `
      UPDATE categories
      SET image_url = ?
      WHERE category_id = ?
      `,
      [newUrl, cat.category_id]
    );

    console.log("Migrated category image:", cat.image_url, "=>", newUrl);
  }
}

function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";

  return "application/octet-stream";
}

async function run() {
  try {
    console.log("Starting image migration...");

    await migrateProductImages();
    await migrateCategoryImages();

    console.log("Image migration completed.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

run();