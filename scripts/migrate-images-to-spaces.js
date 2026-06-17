require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../src/config/db");
const uploadToSpaces = require("../src/services/spaces");

function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";

  return "application/octet-stream";
}

function findLocalFile(folder, fileName) {
  const possiblePaths = [
    path.join(__dirname, "..", "uploads", folder, fileName),
    path.join(__dirname, "..", "src", "uploads", folder, fileName),
    path.join(process.cwd(), "uploads", folder, fileName),
    path.join(process.cwd(), "src", "uploads", folder, fileName),
  ];

  return possiblePaths.find((p) => fs.existsSync(p));
}

async function migrateProductImages() {
  const [images] = await db.query(`
    SELECT image_id, image_url
    FROM product_images
    WHERE image_url LIKE '/uploads/products/%'
  `);

  console.log(`Product images found: ${images.length}`);

  for (const img of images) {
    const fileName = path.basename(img.image_url);
    const localPath = findLocalFile("products", fileName);

    if (!localPath) {
      console.log("Missing product image:", fileName);
      continue;
    }

    const file = {
      originalname: fileName,
      buffer: fs.readFileSync(localPath),
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

    console.log("Migrated product:", fileName);
  }
}

async function migrateCategoryImages() {
  const [categories] = await db.query(`
    SELECT category_id, image_url
    FROM categories
    WHERE image_url LIKE '/uploads/categories/%'
  `);

  console.log(`Category images found: ${categories.length}`);

  for (const cat of categories) {
    const fileName = path.basename(cat.image_url);
    const localPath = findLocalFile("categories", fileName);

    if (!localPath) {
      console.log("Missing category image:", fileName);
      continue;
    }

    const file = {
      originalname: fileName,
      buffer: fs.readFileSync(localPath),
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

    console.log("Migrated category:", fileName);
  }
}

async function run() {
  try {
    console.log("Starting image migration...");
    console.log("Bucket:", process.env.DO_SPACES_BUCKET);

    await migrateProductImages();
    await migrateCategoryImages();

    console.log("Migration completed.");
    process.exit(0);
} catch (error) {
    console.error("Migration failed:", error);
    console.error("Error name:", error.name);
    console.error("Error code:", error.Code || error.code);
    console.error("HTTP:", error.$metadata?.httpStatusCode);
    process.exit(1);
  }
}

run();