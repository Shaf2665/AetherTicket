import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import os, { NetworkInterfaceInfo, NetworkInterfaceInfoIPv4 } from 'os';
import { Client } from 'discord.js';
import { BotConfig, saveConfig, loadConfig } from '../utils/configLoader';
import { normalizeConfig } from '../utils/validation';
import { logger } from '../utils/logger';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

const jsonLimit = process.env.WEBUI_JSON_LIMIT || '256kb';
app.use(express.json({ limit: jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonLimit }));

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        formAction: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const staticPath = path.join(__dirname, 'public');
if (fs.existsSync(staticPath)) {
  app.use(
    express.static(staticPath, {
      maxAge: '1h',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );
}

const uploadsDir = path.join(process.cwd(), 'uploads');
const webUiHost = process.env.WEBUI_HOST ?? '127.0.0.1';

const rateLimitWindowMs = Number(process.env.WEBUI_RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMax = Number(process.env.WEBUI_RATE_LIMIT_MAX ?? 100);

const apiLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

const webUiPassword = process.env.WEBUI_PASSWORD;
const webUiUsername = process.env.WEBUI_USERNAME ?? 'admin';

const unprotectedPaths = new Set(['/health', '/diagnostic']);

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!webUiPassword) {
    return next();
  }

  if (unprotectedPaths.has(req.path)) {
    return next();
  }

  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AetherTicket", charset="UTF-8"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(authorization.slice(6), 'base64').toString();
  const separatorIndex = credentials.indexOf(':');
  if (separatorIndex < 0) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AetherTicket", charset="UTF-8"');
    return res.status(401).send('Invalid credentials');
  }
  const providedUser = credentials.slice(0, separatorIndex);
  const providedPassword = credentials.slice(separatorIndex + 1);

  const providedUserBuffer = Buffer.from(providedUser);
  const expectedUserBuffer = Buffer.from(webUiUsername);
  const providedPasswordBuffer = Buffer.from(providedPassword);
  const expectedPasswordBuffer = Buffer.from(webUiPassword);

  const usernameMatches =
    providedUserBuffer.length === expectedUserBuffer.length &&
    crypto.timingSafeEqual(providedUserBuffer, expectedUserBuffer);
  const passwordMatches =
    providedPasswordBuffer.length === expectedPasswordBuffer.length &&
    crypto.timingSafeEqual(providedPasswordBuffer, expectedPasswordBuffer);

  if (!usernameMatches || !passwordMatches) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AetherTicket", charset="UTF-8"');
    return res.status(401).send('Invalid credentials');
  }

  return next();
}

app.use((req, res, next) => requireAuth(req, res, next));
app.use('/api', apiLimiter);

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    cb(null, 'avatar.png');
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only PNG, JPEG, or WEBP images are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

export function startWebUI(port: number, _config: BotConfig, client: Client) {
  // Main config page
  app.get('/', (req, res) => {
    const currentConfig = normalizeConfig(loadConfig());
    const avatarPath = currentConfig.avatar;
    const avatarExists = fs.existsSync(path.resolve(avatarPath));

    res.render('config', {
      botName: currentConfig.botName,
      embedColor: currentConfig.embedColor,
      footerText: currentConfig.footerText,
      ticketCategory: currentConfig.ticketCategory,
      supportRole: currentConfig.supportRole,
      avatarPath: avatarExists ? avatarPath : null,
      botTag: client.user?.tag || 'Not connected',
      botAvatar: client.user?.displayAvatarURL() || null,
    });
  });

  // Get config API
  app.get('/api/config', (req, res) => {
    const currentConfig = normalizeConfig(loadConfig());
    res.json(currentConfig);
  });

  // Update config API
  app.post('/api/config', (req, res) => {
    try {
      const currentConfig = normalizeConfig(loadConfig());
      const updatedConfig = normalizeConfig({
        ...currentConfig,
        botName: req.body.botName,
        embedColor: req.body.embedColor,
        footerText: req.body.footerText,
        ticketCategory: req.body.ticketCategory,
        supportRole: req.body.supportRole,
      });

      if (saveConfig(updatedConfig)) {
        // Update bot name if changed
        if (updatedConfig.botName !== currentConfig.botName && client.user) {
          client.user.setUsername(updatedConfig.botName).catch((err) => {
            logger.error('Failed to update bot name:', err);
          });
        }

        res.json({ success: true, config: updatedConfig });
      } else {
        res.status(500).json({ success: false, error: 'Failed to save config' });
      }
    } catch (error) {
      logger.error('Failed to update config:', error);
      res.status(500).json({ success: false, error: 'Failed to update config' });
    }
  });

  // Avatar upload
  app.post('/api/avatar', upload.single('avatar'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      const fileBuffer = await fs.promises.readFile(req.file.path);
      const { fileTypeFromBuffer } = await import('file-type');
      const detectedType = await fileTypeFromBuffer(fileBuffer);

      if (!detectedType || !['image/png', 'image/jpeg', 'image/webp'].includes(detectedType.mime)) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ success: false, error: 'Invalid image format' });
      }

      const currentConfig = normalizeConfig(loadConfig());
      const avatarPath = path.join(process.cwd(), 'avatar.png');

      // Copy uploaded file to avatar.png
      await fs.promises.copyFile(req.file.path, avatarPath);
      await fs.promises.chmod(avatarPath, 0o600);
      await fs.promises.unlink(req.file.path).catch(() => undefined);

      // Update config
      const updatedConfig = normalizeConfig({
        ...currentConfig,
        avatar: './avatar.png',
      });

      saveConfig(updatedConfig);

      // Update bot avatar
      if (client.user) {
        await client.user.setAvatar(avatarPath);
        logger.info('Bot avatar updated');
      }

      res.json({ success: true, message: 'Avatar updated successfully' });
    } catch (error) {
      logger.error('Failed to upload avatar:', error);
      res.status(500).json({ success: false, error: 'Failed to upload avatar' });
    }
  });

  app.get('/avatar.png', (req, res) => {
    const avatarPath = path.join(process.cwd(), 'avatar.png');
    if (!fs.existsSync(avatarPath)) {
      return res.status(404).end();
    }

    return res.sendFile(avatarPath);
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'aetherticket', timestamp: new Date().toISOString() });
  });

  // Diagnostic endpoint
  app.get('/diagnostic', (_req, res) => {
    const networkInterfaces = os.networkInterfaces();
    const ipv4Address = Object.values(networkInterfaces)
      .flat()
      .filter((iface): iface is NetworkInterfaceInfo => Boolean(iface))
      .find(
        (iface): iface is NetworkInterfaceInfoIPv4 =>
          iface.family === 'IPv4' && iface.internal === false
      );

    res.json({
      status: 'ok',
      service: 'aetherticket',
      port,
      host: webUiHost,
      protocol: 'http',
      serverIP: ipv4Address?.address ?? 'unknown',
      timestamp: new Date().toISOString(),
      message:
        'If you see this, the Web UI is working correctly. If you get HTTPS errors, check for reverse proxies or load balancers.',
    });
  });

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      logger.error('Unhandled error in Web UI middleware', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  );

  const server = app.listen(port, webUiHost, () => {
    logger.info(`Web UI server started on http://${webUiHost}:${port}`);
    if (webUiHost === '127.0.0.1' || webUiHost === 'localhost') {
      logger.info(`Web UI accessible locally at http://localhost:${port}`);
    } else {
      logger.info(`Web UI accessible at http://${webUiHost}:${port}`);
    }
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Diagnostic: http://localhost:${port}/diagnostic`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use. The port finder should have handled this.`);
      logger.error(`Check what's using port ${port}: netstat -tulnp | grep ${port}`);
      logger.error(`Please manually set PORT in .env to an available port`);
    } else {
      logger.error(`Failed to start Web UI server: ${error.message}`);
    }
  });
}
