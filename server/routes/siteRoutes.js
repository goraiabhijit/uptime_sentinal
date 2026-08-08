const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const PingLog = require('../models/PingLog');
const { inspectSite } = require('../services/inspector');
const { requireAuth } = require('@clerk/express');

/**
 * GET /api/sites
 * Fetch all sites for the user and compute true uptime percentage
 */
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const sites = await Site.find({ userId }).sort({ createdAt: -1 });

    const sitesWithMetrics = await Promise.all(sites.map(async (site) => {
      const totalLogs = await PingLog.countDocuments({ siteId: site._id });
      const upLogs = await PingLog.countDocuments({ siteId: site._id, status: 'UP' });
      const downLogs = totalLogs - upLogs;

      // Calculate percentage with fallback for 0 logs
      let uptimePercentage = 100;
      if (totalLogs > 0) {
        uptimePercentage = parseFloat(((upLogs / totalLogs) * 100).toFixed(1));
      } else if (site.status === 'DOWN') {
        uptimePercentage = 0;
      }

      return {
        ...site.toObject(),
        upLogs,
        downLogs,
        totalLogs,
        uptimePercentage
      };
    }));

    const stats = {
      total: sites.length,
      up: sites.filter(s => s.status === 'UP').length,
      down: sites.filter(s => s.status === 'DOWN').length,
      degraded: sites.filter(s => s.status === 'DEGRADED').length,
    };

    res.json({ stats, sites: sitesWithMetrics });
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

/**
 * POST /api/sites
 * Add new site with duplicate name/URL check & syntax validation
 */
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const { name, url, alertWebhookUrl } = req.body;

    const trimmedName = name.trim();
    let targetUrl = url.trim();

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    // 1. Validate URL syntax
    try {
      new URL(targetUrl);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid URL format. Example: https://example.com' });
    }

    // 2. Prevent duplicate URL for the same user
    const existingUrl = await Site.findOne({ userId, url: targetUrl });
    if (existingUrl) {
      return res.status(400).json({ message: 'You are already monitoring this URL.' });
    }

    // 3. Prevent duplicate Name for the same user (case-insensitive)
    const existingName = await Site.findOne({ 
      userId, 
      name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } 
    });
    if (existingName) {
      return res.status(400).json({ message: 'A monitor with this name already exists.' });
    }

    const newSite = new Site({ userId, name: trimmedName, url: targetUrl, alertWebhookUrl: alertWebhookUrl || '' });
    const initialResult = await inspectSite(newSite);

    newSite.status = initialResult.status;
    newSite.lastChecked = new Date();
    newSite.lastResponseTime = initialResult.responseTime;
    newSite.lastStatusCode = initialResult.statusCode;
    newSite.sslDaysRemaining = initialResult.sslDaysRemaining;

    await newSite.save();

    await PingLog.create({
      siteId: newSite._id,
      statusCode: initialResult.statusCode,
      responseTime: initialResult.responseTime,
      status: initialResult.status,
      errorMessage: initialResult.errorMessage || ''
    });

    res.status(201).json(newSite);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create site', error: error.message });
  }
});

/**
 * POST /api/sites/:id/ping
 * Trigger instant manual ping
 */
router.post('/:id/ping', requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const site = await Site.findOne({ _id: req.params.id, userId });
    if (!site) return res.status(404).json({ message: 'Site not found' });

    const result = await inspectSite(site);
    site.status = result.status;
    site.lastChecked = new Date();
    site.lastResponseTime = result.responseTime;
    site.lastStatusCode = result.statusCode;
    site.sslDaysRemaining = result.sslDaysRemaining;
    await site.save();

    await PingLog.create({
      siteId: site._id,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      status: result.status,
      errorMessage: result.errorMessage || ''
    });

    res.json({ site });
  } catch (error) {
    res.status(500).json({ message: 'Manual ping failed', error: error.message });
  }
});

/**
 * GET /api/sites/:id/logs
 * Fetch ping logs for chart mapping
 */
router.get('/:id/logs', requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const site = await Site.findOne({ _id: req.params.id, userId });
    if (!site) return res.status(404).json({ message: 'Site not found' });

    const logs = await PingLog.find({ siteId: req.params.id }).sort({ createdAt: -1 }).limit(50);
    res.json(logs.reverse());
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch logs', error: error.message });
  }
});

/**
 * DELETE /api/sites/:id
 */
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const site = await Site.findOneAndDelete({ _id: req.params.id, userId });
    if (!site) return res.status(404).json({ message: 'Site not found' });

    await PingLog.deleteMany({ siteId: req.params.id });
    res.json({ message: 'Site and logs deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete site', error: error.message });
  }
});

/**
 * PUT /api/sites/:id
 * Update site with duplicate checks
 */
router.put('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const { name, url, alertWebhookUrl } = req.body;
    const site = await Site.findOne({ _id: req.params.id, userId });
    if (!site) return res.status(404).json({ message: 'Site not found' });

    // Validate Name if changing
    if (name) {
      const trimmedName = name.trim();
      const existingName = await Site.findOne({ 
        userId, 
        _id: { $ne: req.params.id }, 
        name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } 
      });
      if (existingName) {
        return res.status(400).json({ message: 'A monitor with this name already exists.' });
      }
      site.name = trimmedName;
    }

    // Validate URL if changing
    if (url) {
      let targetUrl = url.trim();
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `https://${targetUrl}`;
      }

      try {
        new URL(targetUrl);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid URL format.' });
      }

      const existingUrl = await Site.findOne({ 
        userId, 
        _id: { $ne: req.params.id }, 
        url: targetUrl 
      });
      if (existingUrl) {
        return res.status(400).json({ message: 'You are already monitoring this URL.' });
      }

      site.url = targetUrl;
    }

    if (alertWebhookUrl !== undefined) site.alertWebhookUrl = alertWebhookUrl;

    const result = await inspectSite(site);
    site.status = result.status;
    site.lastChecked = new Date();
    site.lastResponseTime = result.responseTime;
    site.lastStatusCode = result.statusCode;
    site.sslDaysRemaining = result.sslDaysRemaining;

    await site.save();
    res.json(site);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update site', error: error.message });
  }
});

module.exports = router;