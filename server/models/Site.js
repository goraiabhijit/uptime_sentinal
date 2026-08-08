const mongoose = require("mongoose");

const SiteSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    status: { type: String, enum: ["UP", "DOWN", "DEGRADED"], default: "UP" },
    lastChecked: { type: Date, default: Date.now },
    lastResponseTime: { type: Number, default: 0 },
    lastStatusCode: { type: Number, default: null }, // Stores HTTP Code (200, 404, 500, etc.)
    sslDaysRemaining: { type: Number, default: null },
    alertWebhookUrl: { type: String, default: "" },
    consecutiveFailures: { type: Number, default: 0 },
    // GitHub scanner fields (null for manually added monitors)
    method: { type: String, enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], default: "GET" },
    sourceRepo: { type: String, default: null },
    pathParamDefaults: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Site", SiteSchema);