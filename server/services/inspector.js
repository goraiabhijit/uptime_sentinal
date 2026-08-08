const axios = require("axios");
const tls = require("tls");
const { URL } = require("url");

/**
 * Connects via native TLS socket on port 443 to inspect SSL certificate validity.
 * @param {string} targetUrl
 * @returns {Promise<number|null>} Days remaining until SSL expiration, or null if HTTP.
 */
function getSSLDaysRemaining(targetUrl) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(targetUrl);

      // SSL inspection only applies to HTTPS endpoints
      if (parsedUrl.protocol !== "https:") {
        return resolve(null);
      }

      const hostname = parsedUrl.hostname;
      const port = parsedUrl.port || 443;

      const socket = tls.connect(
        port,
        hostname,
        { servername: hostname },
        () => {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            socket.destroy();
            return resolve(null);
          }

          const expiryDate = new Date(cert.valid_to);
          const now = new Date();
          const diffInMs = expiryDate.getTime() - now.getTime();
          const daysRemaining = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

          socket.destroy();
          resolve(daysRemaining);
        },
      );

      socket.on("error", () => resolve(null));
      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve(null);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

/**
 * Pings target site, measures response time, and evaluates health status.
 * @param {Object} site Mongoose Site document
 */
async function inspectSite(site) {
  const startTime = Date.now();
  let statusCode = 0;
  let responseTime = 0;
  let status = "DOWN";
  let errorMessage = null;

  try {
    const response = await axios.get(site.url, {
      timeout: 10000, // 10-second timeout
      headers: { "User-Agent": "UptimeSentinel/1.0" },
      validateStatus: false, // Allow catching 4xx/5xx status codes manually
    });

    responseTime = Date.now() - startTime;
    statusCode = response.status;

  if ((statusCode >= 200 && statusCode < 400) || statusCode === 401 || statusCode === 404) {
      // Degraded if latency > 2000ms, otherwise UP
      status = responseTime > 2000 ? "DEGRADED" : "UP";
    } else {
      status = "DOWN";
      errorMessage = `HTTP Status Code: ${statusCode}`;
    }
  } catch (error) {
    responseTime = Date.now() - startTime;
    statusCode = error.response ? error.response.status : 500;
    errorMessage = error.message || "Network Timeout / Unreachable";
    status = "DOWN";
  }

  // Check SSL certificate expiration in parallel
  const sslDaysRemaining = await getSSLDaysRemaining(site.url);
  console.log(`[INSPECTION] ${site.name} (${site.url}) -> Status: ${status} | Latency: ${responseTime}ms`);

  return {
    statusCode,
    responseTime,
    status,
    sslDaysRemaining,
    errorMessage,
  };
}

module.exports = { inspectSite, getSSLDaysRemaining };
