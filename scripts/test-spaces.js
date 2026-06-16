require("dotenv").config();

console.log("KEY:", process.env.DO_SPACES_KEY ? "loaded" : "missing");
console.log("SECRET:", process.env.DO_SPACES_SECRET ? "loaded" : "missing");
console.log("BUCKET:", process.env.DO_SPACES_BUCKET);
console.log("REGION:", process.env.DO_SPACES_REGION);
console.log("ENDPOINT:", process.env.DO_SPACES_ENDPOINT);