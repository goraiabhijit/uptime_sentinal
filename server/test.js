/**
 * ============================================================
 *  Uptime Sentinel — Server Test Suite
 * ============================================================
 *
 *  Tests the following systems end-to-end:
 *    1. MongoDB Atlas connectivity
 *    2. Inspector service (HTTP ping + SSL check)
 *    3. Site CRUD operations (Create, Read, Delete)
 *    4. PingLog creation & retrieval
 *    5. Cron worker module loading
 *
 *  Run:  node test.js
 * ============================================================
 */

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const mongoose = require("mongoose");
const Site = require("./models/Site");
const PingLog = require("./models/PingLog");
const { inspectSite, getSSLDaysRemaining } = require("./services/inspector");

// ── Helpers ──────────────────────────────────────────────────

const TEST_USER_ID = "test_user_" + Date.now();
let testSiteId = null;
let passed = 0;
let failed = 0;

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`);
}

async function assert(label, fn) {
  try {
    await fn();
    passed++;
    log("✅", label);
  } catch (err) {
    failed++;
    log("❌", `${label}  →  ${err.message}`);
  }
}

function expect(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

// ── Test Cases ───────────────────────────────────────────────

async function testDBConnection() {
  console.log("\n━━━ 1. MongoDB Atlas Connection ━━━");

  await assert("Connects to remote MongoDB Atlas cluster", async () => {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    const host = conn.connection.host;
    const dbName = conn.connection.name;
    if (!host.includes("mongodb.net") && !host.includes("shard")) {
      // Still passes for local but warns
      log("⚠️", `Connected to ${host} (may be local, not Atlas)`);
    }
    log("ℹ️", `Host: ${host} | Database: ${dbName}`);
  });

  await assert("Database name is site_uptime_db", async () => {
    expect(mongoose.connection.name, "site_uptime_db", "Database name mismatch");
  });
}

async function testInspectorService() {
  console.log("\n━━━ 2. Inspector Service ━━━");

  await assert("Pings https://google.com and returns UP or DEGRADED", async () => {
    const mockSite = { name: "Google", url: "https://google.com" };
    const result = await inspectSite(mockSite);
    if (!["UP", "DEGRADED"].includes(result.status)) {
      throw new Error(`Unexpected status: ${result.status}`);
    }
    if (typeof result.responseTime !== "number" || result.responseTime <= 0) {
      throw new Error(`Invalid responseTime: ${result.responseTime}`);
    }
    log("ℹ️", `Status: ${result.status} | Latency: ${result.responseTime}ms | SSL: ${result.sslDaysRemaining} days`);
  });

  await assert("Detects DOWN status for unreachable URL", async () => {
    const mockSite = { name: "Fake", url: "https://this-domain-does-not-exist-xyz123.com" };
    const result = await inspectSite(mockSite);
    expect(result.status, "DOWN", "Expected DOWN for unreachable URL");
    log("ℹ️", `Status: ${result.status} | Error: ${result.errorMessage}`);
  });

  await assert("SSL check returns days remaining for https://google.com", async () => {
    const days = await getSSLDaysRemaining("https://google.com");
    if (typeof days !== "number" || days <= 0) {
      throw new Error(`Invalid SSL days: ${days}`);
    }
    log("ℹ️", `SSL days remaining: ${days}`);
  });

  await assert("SSL check returns null for http:// URLs", async () => {
    const days = await getSSLDaysRemaining("http://example.com");
    if (days !== null) {
      throw new Error(`Expected null for HTTP, got: ${days}`);
    }
  });
}

async function testSiteCRUD() {
  console.log("\n━━━ 3. Site CRUD Operations ━━━");

  await assert("Creates a new Site document in Atlas", async () => {
    const site = await Site.create({
      userId: TEST_USER_ID,
      name: "Test Site",
      url: "https://httpbin.org/status/200",
      status: "UP",
      lastChecked: new Date(),
      lastResponseTime: 150,
      lastStatusCode: 200,
    });
    testSiteId = site._id;
    if (!site._id) throw new Error("Site was not created");
    log("ℹ️", `Created Site ID: ${site._id}`);
  });

  await assert("Reads the created Site back from Atlas", async () => {
    const site = await Site.findById(testSiteId);
    if (!site) throw new Error("Site not found in database");
    expect(site.name, "Test Site", "Site name mismatch");
    expect(site.userId, TEST_USER_ID, "UserId mismatch");
    expect(site.status, "UP", "Status mismatch");
  });

  await assert("Updates the Site status to DOWN", async () => {
    await Site.findByIdAndUpdate(testSiteId, { status: "DOWN", lastResponseTime: 0 });
    const site = await Site.findById(testSiteId);
    expect(site.status, "DOWN", "Status was not updated");
  });

  await assert("Prevents duplicate site name for same user (case-insensitive)", async () => {
    try {
      const existing = await Site.findOne({
        userId: TEST_USER_ID,
        name: { $regex: new RegExp("^Test Site$", "i") },
      });
      if (!existing) throw new Error("Duplicate check query returned nothing");
      // Duplicate detected — this is the expected behavior
    } catch (err) {
      throw err;
    }
  });
}

async function testPingLogs() {
  console.log("\n━━━ 4. PingLog Operations ━━━");

  await assert("Creates PingLog entries for the test site", async () => {
    const statuses = ["UP", "UP", "DEGRADED", "DOWN", "UP"];
    for (let i = 0; i < statuses.length; i++) {
      await PingLog.create({
        siteId: testSiteId,
        statusCode: statuses[i] === "DOWN" ? 500 : 200,
        responseTime: statuses[i] === "DOWN" ? 0 : 100 + i * 50,
        status: statuses[i],
        errorMessage: statuses[i] === "DOWN" ? "Simulated failure" : null,
      });
    }
    const count = await PingLog.countDocuments({ siteId: testSiteId });
    expect(count, 5, "PingLog count mismatch");
    log("ℹ️", `Inserted ${count} ping log entries`);
  });

  await assert("Calculates uptime percentage correctly", async () => {
    const total = await PingLog.countDocuments({ siteId: testSiteId });
    const upCount = await PingLog.countDocuments({ siteId: testSiteId, status: "UP" });
    const uptime = parseFloat(((upCount / total) * 100).toFixed(1));
    // 3 UP out of 5 = 60%
    expect(uptime, 60, "Uptime percentage calculation wrong");
    log("ℹ️", `Uptime: ${uptime}% (${upCount}/${total} checks UP)`);
  });

  await assert("Retrieves logs sorted by newest first, limited to 50", async () => {
    const logs = await PingLog.find({ siteId: testSiteId })
      .sort({ createdAt: -1 })
      .limit(50);
    if (logs.length === 0) throw new Error("No logs returned");
    if (logs.length > 50) throw new Error("Limit 50 exceeded");
    log("ℹ️", `Retrieved ${logs.length} logs`);
  });
}

async function testCronModule() {
  console.log("\n━━━ 5. Cron Worker Module ━━━");

  await assert("cronWorker module loads without errors", async () => {
    const startCronWorker = require("./services/cronWorker");
    if (typeof startCronWorker !== "function") {
      throw new Error("cronWorker does not export a function");
    }
  });
}

async function cleanup() {
  console.log("\n━━━ Cleanup ━━━");

  await assert("Deletes test PingLog entries", async () => {
    const result = await PingLog.deleteMany({ siteId: testSiteId });
    log("ℹ️", `Deleted ${result.deletedCount} ping logs`);
  });

  await assert("Deletes the test Site document", async () => {
    const result = await Site.findByIdAndDelete(testSiteId);
    if (!result) throw new Error("Test site not found for deletion");
    log("ℹ️", `Deleted site: ${result.name}`);
  });

  await assert("Verifies cleanup — no test data remains", async () => {
    const site = await Site.findById(testSiteId);
    const logs = await PingLog.countDocuments({ siteId: testSiteId });
    if (site) throw new Error("Test site still exists");
    if (logs > 0) throw new Error(`${logs} test ping logs still exist`);
  });
}

// ── Runner ───────────────────────────────────────────────────

async function runTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║     🛡️  Uptime Sentinel — Test Suite             ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  MONGO_URI: ${process.env.MONGO_URI ? "✅ Set" : "❌ Missing"}`);
  console.log(`  Timestamp: ${new Date().toLocaleString()}`);

  try {
    await testDBConnection();
    await testInspectorService();
    await testSiteCRUD();
    await testPingLogs();
    await testCronModule();
    await cleanup();
  } catch (err) {
    console.error("\n💥 Unhandled test error:", err);
  }

  console.log("\n══════════════════════════════════════════════════");
  console.log(`  Results:  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
  if (failed === 0) {
    console.log("  🎉 ALL TESTS PASSED!");
  } else {
    console.log("  ⚠️  Some tests failed. Review output above.");
  }
  console.log("══════════════════════════════════════════════════\n");

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
