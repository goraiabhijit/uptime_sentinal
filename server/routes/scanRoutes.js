const express = require('express');
const router = express.Router();
const { requireAuth, getAuth } = require('@clerk/express');
const { scanRepo } = require('../services/githubScanner');
const Site = require('../models/Site');
const PingLog = require('../models/PingLog');
const { inspectSite } = require('../services/inspector');

// ─── Auth Helper ──────────────────────────────────────────────────────────────

function getUserId(req) {
  try {
    const auth = getAuth(req);
    if (auth && auth.userId) return auth.userId;
  } catch (_) {}
  if (req.auth && req.auth.userId) return req.auth.userId;
  return 'demo_user';
}

// ─── POST /api/scan/github ────────────────────────────────────────────────────
/**
 * Scans a GitHub repo for API endpoint definitions.
 * Body: { repo: "owner/repo", scanAll: false, token?: "ghp_..." }
 */
router.post('/github', requireAuth(), async (req, res) => {
  const { repo, scanAll = false, token } = req.body;

  if (!repo || typeof repo !== 'string') {
    return res.status(400).json({ error: 'invalid_input', message: 'repo is required (e.g. "owner/repo")' });
  }

  try {
    const result = await scanRepo(repo, { scanAll, token });
    return res.json({
      defaultBranch: result.defaultBranch,
      endpoints: result.endpoints,
      duplicatesFound: result.duplicatesFound,
      truncated: result.truncated,
      warnings: result.warnings,
    });
  } catch (err) {
    console.error('[ScanRoute] Error:', err.message);

    const code = err.code;

    if (code === 'invalid_input') {
      return res.status(400).json({ error: code, message: err.message });
    }
    if (code === 'repo_not_found') {
      return res.status(404).json({ error: code, message: `Repository not found. Check for typos in "${repo}".` });
    }
    if (code === 'repo_private_or_forbidden') {
      return res.status(403).json({
        error: code,
        message: 'Repository is private or your token lacks read access. Provide a GitHub PAT with repo scope.',
      });
    }
    if (code === 'github_rate_limited') {
      return res.status(429).json({
        error: code,
        message: 'GitHub API rate limit exhausted. Provide a GitHub token to raise the limit from 60 to 5,000 req/hr.',
        retryAfter: err.retryAfter,
      });
    }
    if (code === 'no_endpoints_detected') {
      return res.status(422).json({
        error: code,
        message: 'No API endpoints were detected in this repository. It may not have a supported framework, spec file, or routing convention.',
      });
    }

    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ─── POST /api/monitors/batch ─────────────────────────────────────────────────
/**
 * Saves approved endpoints as uptime monitors (upsert — idempotent).
 * Body: {
 *   baseUrl: "https://api.example.com",
 *   sourceRepo: "owner/repo",
 *   endpoints: [{ method, path, pathParamOverrides, headers }]
 * }
 */
router.post('/batch', requireAuth(), async (req, res) => {
  const { baseUrl, endpoints, sourceRepo } = req.body;
  const userId = getUserId(req);

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!baseUrl || typeof baseUrl !== 'string') {
    return res.status(400).json({ error: 'invalid_input', message: 'baseUrl is required' });
  }
  try { new URL(baseUrl); } catch (_) {
    return res.status(400).json({ error: 'invalid_input', message: 'baseUrl is not a valid URL' });
  }
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return res.status(400).json({ error: 'invalid_input', message: 'endpoints must be a non-empty array' });
  }

  const normalizedBase = baseUrl.replace(/\/$/, ''); // strip trailing slash

  const results = { created: 0, updated: 0, monitorIds: [], errors: [] };

  // ── Process each endpoint (respond quickly — inspection happens async) ──────
  const savePromises = endpoints.map(async (ep) => {
    const { method = 'GET', path, pathParamOverrides = {}, headers = {} } = ep;

    if (!path || typeof path !== 'string') {
      results.errors.push({ path, error: 'Missing path' });
      return;
    }

    // Resolve path params: replace {id} with override value or keep placeholder
    let resolvedPath = path.replace(/\{(\w+)\}/g, (_, param) => pathParamOverrides[param] ?? `{${param}}`);
    const resolvedUrl = `${normalizedBase}${resolvedPath}`;

    try {
      // Upsert: match on userId + url (resolved URL is the unique monitor identity)
      const existing = await Site.findOne({ userId, url: resolvedUrl });

      if (existing) {
        // Update metadata but preserve monitoring history
        existing.method = method.toUpperCase();
        existing.sourceRepo = sourceRepo || null;
        existing.pathParamDefaults = Object.keys(pathParamOverrides).length ? pathParamOverrides : null;
        await existing.save();
        results.updated++;
        results.monitorIds.push(existing._id.toString());
      } else {
        // Create new monitor
        const name = `${method.toUpperCase()} ${path}`;
        const site = new Site({
          userId,
          name,
          url: resolvedUrl,
          method: method.toUpperCase(),
          sourceRepo: sourceRepo || null,
          pathParamDefaults: Object.keys(pathParamOverrides).length ? pathParamOverrides : null,
          status: 'UP',
          lastChecked: new Date(),
        });

        // Run initial inspection (don't await in main path — fire async)
        // We save first so cron can pick it up immediately, then update with real status
        await site.save();
        results.created++;
        results.monitorIds.push(site._id.toString());

        // Async initial inspection — doesn't block the HTTP response
        setImmediate(async () => {
          try {
            const inspectResult = await inspectSite(site);
            site.status = inspectResult.status;
            site.lastResponseTime = inspectResult.responseTime;
            site.lastStatusCode = inspectResult.statusCode;
            site.sslDaysRemaining = inspectResult.sslDaysRemaining;
            site.lastChecked = new Date();
            await site.save();
            await PingLog.create({
              siteId: site._id,
              statusCode: inspectResult.statusCode,
              responseTime: inspectResult.responseTime,
              status: inspectResult.status,
              errorMessage: inspectResult.errorMessage || null,
            });
          } catch (e) {
            console.error(`[Batch] Initial inspection failed for ${resolvedUrl}: ${e.message}`);
          }
        });
      }
    } catch (err) {
      console.error(`[Batch] Failed to save ${method} ${path}: ${err.message}`);
      results.errors.push({ path, method, error: err.message });
    }
  });

  await Promise.all(savePromises);

  const totalSaved = results.created + results.updated;
  const statusCode = results.errors.length > 0 && totalSaved === 0 ? 500 : 201;

  return res.status(statusCode).json({
    created: results.created,
    updated: results.updated,
    monitorIds: results.monitorIds,
    errors: results.errors.length > 0 ? results.errors : undefined,
  });
});

module.exports = router;
