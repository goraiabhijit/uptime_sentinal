/**
 * GithubEndpointScanner
 * Scans a GitHub repository for API endpoint definitions.
 *
 * Priority order:
 *   1. OpenAPI / Swagger / Postman spec files  (confidence: "high")
 *   2. Framework routing conventions            (confidence: "high")
 *   3. Regex source scan                        (confidence: "low")
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- Constants ---

const GITHUB_API = 'https://api.github.com';
const SPEC_FILENAMES = [
  'openapi.yaml', 'openapi.yml', 'openapi.json',
  'swagger.yaml', 'swagger.yml', 'swagger.json',
];
const POSTMAN_RE = /postman_collection\.json$/i;
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// --- Input Normalisation ---

/**
 * Accepts: "owner/repo", "github.com/owner/repo",
 *          "https://github.com/owner/repo", "https://github.com/owner/repo.git"
 * Returns: { owner, repo }
 */
function normalizeRepoInput(raw) {
  let s = raw.trim().replace(/\.git$/, '');
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^github\.com\//i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw Object.assign(new Error('Invalid repo format. Use owner/repo'), { code: 'invalid_input' });
  }
  return { owner: parts[0], repo: parts[1] };
}

// --- GitHub API Client ---

function makeHeaders(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

function checkRateLimit(response) {
  const remaining = parseInt((response.headers && response.headers['x-ratelimit-remaining']) || '1', 10);
  const reset = parseInt((response.headers && response.headers['x-ratelimit-reset']) || '0', 10);
  if (remaining === 0) {
    const err = new Error('GitHub API rate limit exhausted');
    err.code = 'github_rate_limited';
    err.retryAfter = reset;
    throw err;
  }
}

async function ghGet(urlPath, token) {
  try {
    const res = await axios.get(GITHUB_API + urlPath, {
      headers: makeHeaders(token),
      timeout: 15000,
    });
    checkRateLimit(res);
    return res;
  } catch (err) {
    if (err.code === 'github_rate_limited') throw err;
    if (err.response) {
      checkRateLimit(err.response);
      const status = err.response.status;
      if (status === 404) {
        const e = new Error('Repository not found');
        e.code = 'repo_not_found';
        throw e;
      }
      if (status === 403) {
        const e = new Error('Repository private or forbidden');
        e.code = 'repo_private_or_forbidden';
        throw e;
      }
      if (status === 401) {
        const e = new Error('Bad or missing GitHub token');
        e.code = 'repo_private_or_forbidden';
        throw e;
      }
    }
    throw err;
  }
}

// --- Repo Meta & Tree Fetch ---

async function getDefaultBranch(owner, repo, token) {
  const res = await ghGet('/repos/' + owner + '/' + repo, token);
  return res.data.default_branch;
}

async function fetchTreeRecursive(owner, repo, branch, token) {
  const res = await ghGet('/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1', token);
  const tree = res.data.tree;
  const truncated = res.data.truncated;

  if (!truncated) return { tree: tree, truncated: false };

  // Fallback: non-recursive top-level, then expand interesting dirs
  console.warn('[Scanner] Tree truncated for ' + owner + '/' + repo + '. Fetching non-recursive top-level.');
  const topRes = await ghGet('/repos/' + owner + '/' + repo + '/git/trees/' + branch, token);
  const allItems = topRes.data.tree.slice();

  const interestingDirs = topRes.data.tree.filter(function(item) {
    return item.type === 'tree' && /^(app|pages|src|routes|routers|api|docs)$/i.test(item.path);
  });

  for (const dir of interestingDirs) {
    try {
      const sub = await ghGet('/repos/' + owner + '/' + repo + '/git/trees/' + dir.sha + '?recursive=1', token);
      sub.data.tree.forEach(function(item) {
        allItems.push(Object.assign({}, item, { path: dir.path + '/' + item.path }));
      });
    } catch (_) {
      // skip inaccessible subtrees
    }
  }
  return { tree: allItems, truncated: true };
}

// --- Blob Fetcher ---

async function fetchBlobContent(owner, repo, filePath, branch, token) {
  try {
    const res = await axios.get(
      'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + filePath,
      { headers: makeHeaders(token), timeout: 10000 },
    );
    return res.data;
  } catch (_) {
    return null;
  }
}

// --- Path Normalisation ---

function normalizePath(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  return (
    raw
      .replace(/:(\w+)/g, '{$1}')                     // :id -> {id}
      .replace(/\[(\w+)\]/g, '{$1}')                  // [id] -> {id}
      .replace(/<(\w+)>/g, '{$1}')                    // <id> -> {id}
      .replace(/\(\?P?[<{](\w+)[>}][^)]*\)/g, '{$1}') // Django/FastAPI regex params
      .replace(/\/+/g, '/')                            // collapse double slashes
      .replace(/\/$/, '')                              // strip trailing slash
  ) || '/';
}

// --- Tier 1: Spec File Parsers ---

async function parseOpenApiSpec(content, sourceFile) {
  const endpoints = [];
  try {
    let spec;
    if (typeof content === 'string') {
      if (content.trimStart().startsWith('{')) {
        spec = JSON.parse(content);
      } else {
        const yaml = require('js-yaml');
        spec = yaml.load(content);
      }
    } else {
      spec = content;
    }

    const paths = spec.paths || {};
    for (const rawPath of Object.keys(paths)) {
      const methods = paths[rawPath];
      for (const method of HTTP_METHODS) {
        if (methods[method]) {
          const op = methods[method];
          endpoints.push({
            method: method.toUpperCase(),
            rawPath: rawPath,
            normalizedPath: normalizePath(rawPath),
            sourceFile: sourceFile,
            sourceLine: null,
            confidence: 'high',
            operationId: op.operationId || null,
            summary: op.summary || null,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Scanner] Failed to parse spec ' + sourceFile + ': ' + err.message);
    return null;
  }
  return endpoints;
}

async function parsePostmanCollection(content, sourceFile) {
  const endpoints = [];
  try {
    const col = typeof content === 'string' ? JSON.parse(content) : content;

    function walkItems(items) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (item.request) {
          const req = item.request;
          const method = (req.method || 'GET').toUpperCase();
          const urlPath = req.url && req.url.path ? req.url.path : [];
          const rawPath = '/' + (Array.isArray(urlPath) ? urlPath.join('/') : urlPath);
          endpoints.push({
            method: method,
            rawPath: rawPath,
            normalizedPath: normalizePath(rawPath),
            sourceFile: sourceFile,
            sourceLine: null,
            confidence: 'high',
            operationId: item.name || null,
            summary: item.name || null,
          });
        }
        if (item.item) walkItems(item.item);
      }
    }

    walkItems(col.item);
  } catch (err) {
    console.warn('[Scanner] Failed to parse Postman collection ' + sourceFile + ': ' + err.message);
    return null;
  }
  return endpoints;
}

// --- Tier 2: Framework Convention Parsers ---

/**
 * Next.js App Router: app/api/** /route.ts(x)
 * Path derived from directory structure, [param] segments map to path params.
 */
function parseNextAppRouter(tree) {
  const endpoints = [];
  const routeFiles = tree.filter(function(item) {
    return item.type === 'blob' && /^app\/api\/.+\/route\.(ts|tsx|js|jsx)$/i.test(item.path);
  });

  for (const file of routeFiles) {
    // e.g. app/api/users/[id]/route.ts -> /api/users/{id}
    const rawPath = '/' + file.path
      .replace(/^app/, '')
      .replace(/\/route\.(ts|tsx|js|jsx)$/i, '')
      .replace(/\[\.\.\.(\w+)\]/g, '{$1*}')
      .replace(/\[(\w+)\]/g, '{$1}');

    // App Router exports HTTP method functions; emit common methods for review
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      endpoints.push({
        method: method,
        rawPath: rawPath,
        normalizedPath: normalizePath(rawPath),
        sourceFile: file.path,
        sourceLine: null,
        confidence: 'high',
      });
    }
  }
  return endpoints;
}

/**
 * Next.js Pages Router: pages/api/** /*.ts
 * Supports [param] and [...slug] catch-all segments.
 */
function parseNextPagesRouter(tree) {
  const endpoints = [];
  const pageFiles = tree.filter(function(item) {
    return item.type === 'blob' && /^(src\/)?pages\/api\/.+\.(ts|tsx|js|jsx)$/i.test(item.path);
  });

  for (const file of pageFiles) {
    const rawPath = '/' + file.path
      .replace(/^(src\/)?pages/, '')
      .replace(/\.(ts|tsx|js|jsx)$/i, '')
      .replace(/\/index$/, '')
      .replace(/\[\.\.\.(\w+)\]/g, '{$1*}')
      .replace(/\[(\w+)\]/g, '{$1}');

    endpoints.push({
      method: 'GET',
      rawPath: rawPath,
      normalizedPath: normalizePath(rawPath),
      sourceFile: file.path,
      sourceLine: null,
      confidence: 'high',
    });
    endpoints.push({
      method: 'POST',
      rawPath: rawPath,
      normalizedPath: normalizePath(rawPath),
      sourceFile: file.path,
      sourceLine: null,
      confidence: 'high',
    });
  }
  return endpoints;
}

/**
 * Express: routes/** /*.js files containing router.<method>( calls
 */
async function parseExpressRoutes(tree, owner, repo, branch, token) {
  const endpoints = [];
  const routeFiles = tree.filter(function(item) {
    return item.type === 'blob' && /^(src\/)?routes?\/[^/]+\.js$/i.test(item.path);
  });

  for (const file of routeFiles) {
    const content = await fetchBlobContent(owner, repo, file.path, branch, token);
    if (!content || typeof content !== 'string') continue;
    if (!content.includes('router.') && !content.includes('app.')) continue;

    const re = /(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = re.exec(content)) !== null) {
      const rawPath = match[2];
      const lineNum = content.substring(0, match.index).split('\n').length;
      endpoints.push({
        method: match[1].toUpperCase(),
        rawPath: rawPath,
        normalizedPath: normalizePath(rawPath),
        sourceFile: file.path,
        sourceLine: lineNum,
        confidence: 'high',
      });
    }
  }
  return endpoints;
}

/**
 * FastAPI: routers/** /*.py with APIRouter and decorated methods
 */
async function parseFastApiRoutes(tree, owner, repo, branch, token) {
  const endpoints = [];
  const routerFiles = tree.filter(function(item) {
    return item.type === 'blob' && /^(app\/)?routers?\/[^/]+\.py$/i.test(item.path);
  });

  for (const file of routerFiles) {
    const content = await fetchBlobContent(owner, repo, file.path, branch, token);
    if (!content || typeof content !== 'string') continue;
    if (!content.includes('APIRouter') && !content.includes('@router.') && !content.includes('@app.')) continue;

    const re = /@(?:router|app)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi;
    let match;
    while ((match = re.exec(content)) !== null) {
      const rawPath = match[2];
      const lineNum = content.substring(0, match.index).split('\n').length;
      endpoints.push({
        method: match[1].toUpperCase(),
        rawPath: rawPath,
        normalizedPath: normalizePath(rawPath),
        sourceFile: file.path,
        sourceLine: lineNum,
        confidence: 'high',
      });
    }
  }
  return endpoints;
}

// --- Tier 3: Regex Fallback ---

const REGEX_PATTERNS = [
  /(?:app|router|server)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi,
  /@(?:router|app)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi,
];

const SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|rb|go|php)$/i;
const SKIP_DIRS = /node_modules|vendor|dist|build|\.next|__pycache__|\.git/i;

async function regexFallback(tree, owner, repo, branch, token) {
  const endpoints = [];
  const sourceFiles = tree
    .filter(function(item) {
      return (
        item.type === 'blob' &&
        SOURCE_EXTENSIONS.test(item.path) &&
        !SKIP_DIRS.test(item.path)
      );
    })
    .slice(0, 50); // limit to avoid rate-limit burn

  for (const file of sourceFiles) {
    const content = await fetchBlobContent(owner, repo, file.path, branch, token);
    if (!content || typeof content !== 'string') continue;

    for (const re of REGEX_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(content)) !== null) {
        const methodRaw = match[1] || 'GET';
        const method = methodRaw.replace(/['"]/g, '').toUpperCase();
        const rawPath = match[2] || match[1];
        if (!rawPath || rawPath.startsWith('$') || rawPath.length > 200) continue;
        const lineNum = content.substring(0, match.index).split('\n').length;
        endpoints.push({
          method: HTTP_METHODS.includes(method.toLowerCase()) ? method : 'GET',
          rawPath: rawPath,
          normalizedPath: normalizePath(rawPath),
          sourceFile: file.path,
          sourceLine: lineNum,
          confidence: 'low',
        });
      }
    }
  }
  return endpoints;
}

// --- Deduplication ---

const CONFIDENCE_RANK = { high: 2, low: 1 };

function deduplicateEndpoints(raw) {
  const map = new Map();
  const duplicatesFound = [];

  for (const ep of raw) {
    const key = ep.method + '::' + ep.normalizedPath;
    if (!map.has(key)) {
      map.set(key, ep);
    } else {
      const existing = map.get(key);
      if ((CONFIDENCE_RANK[ep.confidence] || 0) > (CONFIDENCE_RANK[existing.confidence] || 0)) {
        duplicatesFound.push(Object.assign({}, existing, { replacedBy: ep.sourceFile }));
        map.set(key, ep);
      } else {
        duplicatesFound.push(Object.assign({}, ep, { replacedBy: existing.sourceFile }));
      }
    }
  }

  return {
    endpoints: Array.from(map.values()).map(function(ep) {
      return Object.assign({}, ep, { id: uuidv4(), selected: true });
    }),
    duplicatesFound: duplicatesFound,
  };
}

// --- Main Scanner ---

/**
 * @param {string} repoInput - "owner/repo" or GitHub URL
 * @param {object} options
 * @param {boolean} options.scanAll - scan all tiers even if a higher tier finds results
 * @param {string}  options.token   - GitHub PAT (optional, raises rate limit to 5000/hr)
 */
async function scanRepo(repoInput, options) {
  const opts = options || {};
  const scanAll = opts.scanAll || false;
  const token = opts.token || null;

  const parsed = normalizeRepoInput(repoInput);
  const owner = parsed.owner;
  const repo = parsed.repo;
  const githubToken = token || process.env.GITHUB_TOKEN || null;

  // 1. Resolve default branch and validate repo existence
  const defaultBranch = await getDefaultBranch(owner, repo, githubToken);

  // 2. Fetch file tree
  const treeResult = await fetchTreeRecursive(owner, repo, defaultBranch, githubToken);
  const tree = treeResult.tree;
  const truncated = treeResult.truncated;
  const warnings = truncated ? ['Repository tree was truncated; results may be incomplete.'] : [];

  let allEndpoints = [];
  let foundTier = null;

  // -- Tier 1: Spec files --
  const specFiles = tree.filter(function(item) {
    const name = item.path.split('/').pop().toLowerCase();
    return item.type === 'blob' && (SPEC_FILENAMES.includes(name) || POSTMAN_RE.test(name));
  });

  if (specFiles.length > 0) {
    for (const file of specFiles) {
      const content = await fetchBlobContent(owner, repo, file.path, defaultBranch, githubToken);
      if (!content) continue;
      const isPostman = POSTMAN_RE.test(file.path);
      const parsed2 = isPostman
        ? await parsePostmanCollection(content, file.path)
        : await parseOpenApiSpec(content, file.path);
      if (parsed2 === null) {
        warnings.push('Malformed spec file: ' + file.path + ' - falling through to next strategy.');
        continue;
      }
      allEndpoints = allEndpoints.concat(parsed2);
    }
    if (allEndpoints.length > 0) foundTier = 'spec';
  }

  // -- Tier 2: Framework conventions --
  if (!foundTier || scanAll) {
    const nextApp = parseNextAppRouter(tree);
    const nextPages = parseNextPagesRouter(tree);
    const expressEps = await parseExpressRoutes(tree, owner, repo, defaultBranch, githubToken);
    const fastapiEps = await parseFastApiRoutes(tree, owner, repo, defaultBranch, githubToken);
    const frameworkEndpoints = [].concat(nextApp, nextPages, expressEps, fastapiEps);
    if (frameworkEndpoints.length > 0) {
      allEndpoints = allEndpoints.concat(frameworkEndpoints);
      foundTier = foundTier || 'framework';
    }
  }

  // -- Tier 3: Regex fallback --
  if (!foundTier || scanAll) {
    const regexEndpoints = await regexFallback(tree, owner, repo, defaultBranch, githubToken);
    if (regexEndpoints.length > 0) {
      allEndpoints = allEndpoints.concat(regexEndpoints);
      foundTier = foundTier || 'regex';
    }
  }

  if (allEndpoints.length === 0) {
    const err = new Error('No API endpoints detected in this repository.');
    err.code = 'no_endpoints_detected';
    throw err;
  }

  const result = deduplicateEndpoints(allEndpoints);

  return {
    defaultBranch: defaultBranch,
    endpoints: result.endpoints,
    duplicatesFound: result.duplicatesFound,
    truncated: truncated,
    warnings: warnings,
  };
}

module.exports = { scanRepo: scanRepo, normalizeRepoInput: normalizeRepoInput, normalizePath: normalizePath };
