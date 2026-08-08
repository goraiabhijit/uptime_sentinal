const cron = require('node-cron');
const Site = require('../models/Site');
const PingLog = require('../models/PingLog');
const { inspectSite } = require('./inspector');

function startCronWorker() {
  // Runs every 60 seconds
  cron.schedule('* * * * *', async () => {
    console.log(`\n--- [CRON] Starting automatic inspection cycle: ${new Date().toLocaleTimeString()} ---`);
    
    try {
      const sites = await Site.find();
      console.log(`[CRON] Found ${sites.length} site(s) to inspect.`);

      for (const site of sites) {
        const result = await inspectSite(site);

        // Update site in MongoDB
        site.status = result.status;
        site.lastChecked = new Date();
        site.lastResponseTime = result.responseTime;
        site.sslDaysRemaining = result.sslDaysRemaining;
        await site.save();

        // Create a historical log entry in MongoDB
        await PingLog.create({
          siteId: site._id,
          status: result.status,
          responseTime: result.responseTime
        });

        console.log(`[DB SAVED] Log created in MongoDB for "${site.name}"`);
      }
      
      console.log(`--- [CRON] Cycle completed successfully ---\n`);
    } catch (error) {
      console.error('[CRON ERROR] Inspection failed:', error.message);
    }
  });
}

module.exports = startCronWorker;