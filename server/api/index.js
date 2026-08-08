const serverless = require("serverless-http");
const app = require("../server");
const connectDB = require("../config/db");

let dbPromise = null;
async function ensureDB() {
  if (!dbPromise) dbPromise = connectDB();
  return dbPromise;
}

const handler = serverless(app);

module.exports = async (req, res) => {
  await ensureDB();
  return handler(req, res);
};
