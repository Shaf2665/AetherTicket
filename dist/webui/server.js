"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebUI = startWebUI;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const os_1 = __importDefault(require("os"));
const configLoader_1 = require("../utils/configLoader");
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const app = (0, express_1.default)();
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
app.disable('x-powered-by');
const jsonLimit = process.env.WEBUI_JSON_LIMIT || '256kb';
app.use(express_1.default.json({ limit: jsonLimit }));
app.use(express_1.default.urlencoded({ extended: true, limit: jsonLimit }));
app.use((0, helmet_1.default)({
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
}));
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
});
const staticPath = path_1.default.join(__dirname, 'public');
if (fs_1.default.existsSync(staticPath)) {
    app.use(express_1.default.static(staticPath, {
        maxAge: '1h',
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }));
}
const uploadsDir = path_1.default.join(process.cwd(), 'uploads');
const webUiHost = process.env.WEBUI_HOST ?? '127.0.0.1';
const rateLimitWindowMs = Number(process.env.WEBUI_RATE_LIMIT_WINDOW_MS ?? 60000);
const rateLimitMax = Number(process.env.WEBUI_RATE_LIMIT_MAX ?? 100);
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
});
const webUiPassword = process.env.WEBUI_PASSWORD;
const webUiUsername = process.env.WEBUI_USERNAME ?? 'admin';
const unprotectedPaths = new Set(['/health', '/diagnostic']);
function requireAuth(req, res, next) {
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
    const usernameMatches = providedUserBuffer.length === expectedUserBuffer.length &&
        crypto_1.default.timingSafeEqual(providedUserBuffer, expectedUserBuffer);
    const passwordMatches = providedPasswordBuffer.length === expectedPasswordBuffer.length &&
        crypto_1.default.timingSafeEqual(providedPasswordBuffer, expectedPasswordBuffer);
    if (!usernameMatches || !passwordMatches) {
        res.setHeader('WWW-Authenticate', 'Basic realm="AetherTicket", charset="UTF-8"');
        return res.status(401).send('Invalid credentials');
    }
    return next();
}
app.use((req, res, next) => requireAuth(req, res, next));
app.use('/api', apiLimiter);
// Configure multer for avatar uploads
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(uploadsDir)) {
            fs_1.default.mkdirSync(uploadsDir, { recursive: true });
        }
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        cb(null, 'avatar.png');
    },
});
const upload = (0, multer_1.default)({
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
function startWebUI(port, _config, client) {
    // Main config page
    app.get('/', (req, res) => {
        const currentConfig = (0, validation_1.normalizeConfig)((0, configLoader_1.loadConfig)());
        const avatarPath = currentConfig.avatar;
        const avatarExists = fs_1.default.existsSync(path_1.default.resolve(avatarPath));
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
        const currentConfig = (0, validation_1.normalizeConfig)((0, configLoader_1.loadConfig)());
        res.json(currentConfig);
    });
    // Update config API
    app.post('/api/config', (req, res) => {
        try {
            logger_1.logger.info('Config update request received:', {
                botName: req.body.botName,
                embedColor: req.body.embedColor,
                footerText: req.body.footerText,
                ticketCategory: req.body.ticketCategory,
                supportRole: req.body.supportRole,
            });
            const currentConfig = (0, validation_1.normalizeConfig)((0, configLoader_1.loadConfig)());
            const updatedConfig = (0, validation_1.normalizeConfig)({
                ...currentConfig,
                botName: req.body.botName || currentConfig.botName,
                embedColor: req.body.embedColor || currentConfig.embedColor,
                footerText: req.body.footerText || currentConfig.footerText,
                ticketCategory: req.body.ticketCategory || currentConfig.ticketCategory,
                supportRole: req.body.supportRole || currentConfig.supportRole,
            });
            if ((0, configLoader_1.saveConfig)(updatedConfig)) {
                logger_1.logger.info('Config saved successfully:', updatedConfig);
                // Update bot name if changed
                if (updatedConfig.botName !== currentConfig.botName && client.user) {
                    client.user.setUsername(updatedConfig.botName).catch((err) => {
                        logger_1.logger.error('Failed to update bot name:', err);
                    });
                }
                res.json({ success: true, config: updatedConfig });
            }
            else {
                logger_1.logger.error('Failed to save config file');
                res.status(500).json({ success: false, error: 'Failed to save config' });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to update config:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to update config'
            });
        }
    });
    // Avatar upload
    app.post('/api/avatar', upload.single('avatar'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No file uploaded' });
            }
            const fileBuffer = await fs_1.default.promises.readFile(req.file.path);
            const { fileTypeFromBuffer } = await Promise.resolve().then(() => __importStar(require('file-type')));
            const detectedType = await fileTypeFromBuffer(fileBuffer);
            if (!detectedType || !['image/png', 'image/jpeg', 'image/webp'].includes(detectedType.mime)) {
                await fs_1.default.promises.unlink(req.file.path);
                return res.status(400).json({ success: false, error: 'Invalid image format' });
            }
            const currentConfig = (0, validation_1.normalizeConfig)((0, configLoader_1.loadConfig)());
            const avatarPath = path_1.default.join(process.cwd(), 'avatar.png');
            // Copy uploaded file to avatar.png
            await fs_1.default.promises.copyFile(req.file.path, avatarPath);
            await fs_1.default.promises.chmod(avatarPath, 0o600);
            await fs_1.default.promises.unlink(req.file.path).catch(() => undefined);
            // Update config
            const updatedConfig = (0, validation_1.normalizeConfig)({
                ...currentConfig,
                avatar: './avatar.png',
            });
            (0, configLoader_1.saveConfig)(updatedConfig);
            // Update bot avatar
            if (client.user) {
                await client.user.setAvatar(avatarPath);
                logger_1.logger.info('Bot avatar updated');
            }
            res.json({ success: true, message: 'Avatar updated successfully' });
        }
        catch (error) {
            logger_1.logger.error('Failed to upload avatar:', error);
            res.status(500).json({ success: false, error: 'Failed to upload avatar' });
        }
    });
    app.get('/avatar.png', (req, res) => {
        const avatarPath = path_1.default.join(process.cwd(), 'avatar.png');
        if (!fs_1.default.existsSync(avatarPath)) {
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
        const networkInterfaces = os_1.default.networkInterfaces();
        const ipv4Address = Object.values(networkInterfaces)
            .flat()
            .filter((iface) => Boolean(iface))
            .find((iface) => iface.family === 'IPv4' && iface.internal === false);
        res.json({
            status: 'ok',
            service: 'aetherticket',
            port,
            host: webUiHost,
            protocol: 'http',
            serverIP: ipv4Address?.address ?? 'unknown',
            timestamp: new Date().toISOString(),
            message: 'If you see this, the Web UI is working correctly. If you get HTTPS errors, check for reverse proxies or load balancers.',
        });
    });
    app.use((err, _req, res, _next) => {
        void _next;
        logger_1.logger.error('Unhandled error in Web UI middleware', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
    const server = app.listen(port, webUiHost, () => {
        logger_1.logger.info(`Web UI server started on http://${webUiHost}:${port}`);
        if (webUiHost === '127.0.0.1' || webUiHost === 'localhost') {
            logger_1.logger.info(`Web UI accessible locally at http://localhost:${port}`);
        }
        else {
            logger_1.logger.info(`Web UI accessible at http://${webUiHost}:${port}`);
        }
        logger_1.logger.info(`Health check: http://localhost:${port}/health`);
        logger_1.logger.info(`Diagnostic: http://localhost:${port}/diagnostic`);
    });
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            logger_1.logger.error(`Port ${port} is already in use. The port finder should have handled this.`);
            logger_1.logger.error(`Check what's using port ${port}: netstat -tulnp | grep ${port}`);
            logger_1.logger.error(`Please manually set PORT in .env to an available port`);
        }
        else {
            logger_1.logger.error(`Failed to start Web UI server: ${error.message}`);
        }
    });
}
//# sourceMappingURL=server.js.map