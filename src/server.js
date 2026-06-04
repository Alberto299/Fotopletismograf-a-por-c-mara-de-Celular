const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const { networkInterfaces } = require('node:os');
const { extname, join, normalize } = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PYTHON = process.env.PYTHON || 'python';
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const PYTHON_SCRIPT = join(ROOT, 'python', 'heart_rate.py');
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/medir') {
      const payload = await readJsonBody(req);
      const result = await runPython('measure', payload);
      return sendJson(res, result.statusCode || 200, result.body);
    }

    if (req.method === 'POST' && req.url === '/api/debug-senal') {
      const payload = await readJsonBody(req);
      const result = await runPython('debug', payload);
      return sendJson(res, result.statusCode || 200, result.body);
    }

    if (req.method === 'GET') {
      return serveStatic(req, res);
    }

    sendJson(res, 405, { detail: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, { detail: error.publicMessage || 'SERVER_ERROR' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AVResolutions listo en http://localhost:${PORT}`);
  for (const address of getLocalAddresses()) {
    console.log(`Red local: http://${address}:${PORT}`);
  }
  console.log('Nota: la camara solo funciona en localhost o con HTTPS.');
});

function getLocalAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  try {
    const data = await readFile(filePath);
    const type = contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        const error = new Error('Payload too large');
        error.statusCode = 413;
        error.publicMessage = 'PAYLOAD_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        const error = new Error('Invalid JSON');
        error.statusCode = 400;
        error.publicMessage = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function runPython(action, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [PYTHON_SCRIPT, action], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        const error = new Error(stderr || 'Python process failed');
        error.statusCode = 500;
        error.publicMessage = 'PYTHON_PROCESS_ERROR';
        reject(error);
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          statusCode: parsed.ok ? 200 : parsed.status_code || 422,
          body: parsed.ok ? parsed.data : { detail: parsed.detail, ...parsed.meta }
        });
      } catch {
        const error = new Error(stderr || stdout || 'Invalid Python response');
        error.statusCode = 500;
        error.publicMessage = 'INVALID_PYTHON_RESPONSE';
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}
