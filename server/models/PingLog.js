const mongoose = require("mongoose");

const PingLogSchema = new mongoose.Schema(
  {
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
    },
    statusCode: {
      type: Number,
    },
    responseTime: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["UP", "DOWN", "DEGRADED"],
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PingLog", PingLogSchema);
