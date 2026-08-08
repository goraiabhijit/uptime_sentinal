const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load .env from this file's directory (not process cwd) and override empty shell vars
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const connectDB = require("./config/db");
const siteRoutes = require("./routes/siteRoutes");
const startCronWorker = require("./services/cronWorker");

let clerkMiddleware = null;
const hasClerkKeys = Boolean(
  process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

if (hasClerkKeys) {
  const { clerkMiddleware: clerkExpressMiddleware } = require("@clerk/express");
  clerkMiddleware = clerkExpressMiddleware;
} else {
  console.warn(
    "Clerk keys not configured; running without Clerk auth middleware.",
  );
}

// Connect to MongoDB
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// Clerk must run before protected routes when keys are configured
if (clerkMiddleware) {
  app.use(clerkMiddleware());
}

// 2. Mount API Routes
app.use("/api/sites", siteRoutes);

app.get("/", (req, res) => {
  res.send("Uptime Monitor API & Cron Engine Active");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  // Start the background monitoring worker
  startCronWorker();
});
