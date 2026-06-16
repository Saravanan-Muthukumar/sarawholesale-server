const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.DO_SPACES_REGION,
  endpoint: process.env.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
});

async function uploadToSpaces(file, folder = "products") {
  if (!file) return null;

  const cleanName = file.originalname
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9.-]/g, "")
    .toLowerCase();

  const fileName = `${Date.now()}-${Math.round(
    Math.random() * 1e9
  )}-${cleanName}`;

  const key = `${folder}/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "public-read",
    })
  );

  return `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_REGION}.digitaloceanspaces.com/${key}`;
}

module.exports = uploadToSpaces;