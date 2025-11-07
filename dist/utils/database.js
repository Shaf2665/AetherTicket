"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.createTicket = createTicket;
exports.closeTicket = closeTicket;
exports.getTicketInfo = getTicketInfo;
exports.getUserTickets = getUserTickets;
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("./logger");
const dataDir = path_1.default.join(process.cwd(), 'data');
const dbPath = path_1.default.join(dataDir, 'tickets.db');
// Ensure data directory exists
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
// Initialize database
function initDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.default.Database(dbPath, (err) => {
            if (err) {
                logger_1.logger.error('Failed to open database:', err);
                reject(err);
                return;
            }
            logger_1.logger.info('Database connection established');
            // Create tickets table if it doesn't exist
            db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          transcript TEXT
        )
      `, (err) => {
                if (err) {
                    logger_1.logger.error('Failed to create tickets table:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.info('Tickets table initialized');
                    try {
                        fs_1.default.chmodSync(dbPath, 0o600);
                    }
                    catch (permissionError) {
                        logger_1.logger.warn('Unable to enforce secure permissions on database file', permissionError);
                    }
                    resolve();
                }
                db.close();
            });
        });
    });
}
// Create a new ticket record
function createTicket(channelId, userId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.default.Database(dbPath);
        db.run('INSERT INTO tickets (channel_id, user_id) VALUES (?, ?)', [channelId, userId], function (err) {
            if (err) {
                logger_1.logger.error('Failed to create ticket record:', err);
                reject(err);
            }
            else {
                logger_1.logger.info(`Ticket created: ${channelId} for user ${userId}`);
                resolve();
            }
            db.close();
        });
    });
}
// Close a ticket
function closeTicket(channelId, transcript) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.default.Database(dbPath);
        db.run('UPDATE tickets SET closed_at = CURRENT_TIMESTAMP, transcript = ? WHERE channel_id = ?', [transcript || null, channelId], function (err) {
            if (err) {
                logger_1.logger.error('Failed to close ticket:', err);
                reject(err);
            }
            else {
                logger_1.logger.info(`Ticket closed: ${channelId}`);
                resolve();
            }
            db.close();
        });
    });
}
// Get ticket info
function getTicketInfo(channelId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.default.Database(dbPath);
        db.get('SELECT * FROM tickets WHERE channel_id = ?', [channelId], (err, row) => {
            if (err) {
                logger_1.logger.error('Failed to get ticket info:', err);
                reject(err);
            }
            else {
                resolve(row);
            }
            db.close();
        });
    });
}
// Get all tickets for a user
function getUserTickets(userId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.default.Database(dbPath);
        db.all('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, rows) => {
            if (err) {
                logger_1.logger.error('Failed to get user tickets:', err);
                reject(err);
            }
            else {
                resolve(rows || []);
            }
            db.close();
        });
    });
}
//# sourceMappingURL=database.js.map