import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

export interface TicketRecord {
  id: number;
  channel_id: string;
  user_id: string;
  created_at: string;
  closed_at: string | null;
  transcript: string | null;
}

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'tickets.db');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
export function initDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        logger.error('Failed to open database:', err);
        reject(err);
        return;
      }

      logger.info('Database connection established');

      // Create tickets table if it doesn't exist
      db.run(
        `
        CREATE TABLE IF NOT EXISTS tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          transcript TEXT
        )
      `,
        (err) => {
          if (err) {
            logger.error('Failed to create tickets table:', err);
            reject(err);
          } else {
            logger.info('Tickets table initialized');
            try {
              fs.chmodSync(dbPath, 0o600);
            } catch (permissionError) {
              logger.warn('Unable to enforce secure permissions on database file', permissionError);
            }
            resolve();
          }
          db.close();
        }
      );
    });
  });
}

// Create a new ticket record
export function createTicket(channelId: string, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);

    db.run(
      'INSERT INTO tickets (channel_id, user_id) VALUES (?, ?)',
      [channelId, userId],
      function (err) {
        if (err) {
          logger.error('Failed to create ticket record:', err);
          reject(err);
        } else {
          logger.info(`Ticket created: ${channelId} for user ${userId}`);
          resolve();
        }
        db.close();
      }
    );
  });
}

// Close a ticket
export function closeTicket(channelId: string, transcript?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);

    db.run(
      'UPDATE tickets SET closed_at = CURRENT_TIMESTAMP, transcript = ? WHERE channel_id = ?',
      [transcript || null, channelId],
      function (err) {
        if (err) {
          logger.error('Failed to close ticket:', err);
          reject(err);
        } else {
          logger.info(`Ticket closed: ${channelId}`);
          resolve();
        }
        db.close();
      }
    );
  });
}

// Get ticket info
export function getTicketInfo(channelId: string): Promise<TicketRecord | undefined> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);

    db.get<TicketRecord>('SELECT * FROM tickets WHERE channel_id = ?', [channelId], (err, row) => {
      if (err) {
        logger.error('Failed to get ticket info:', err);
        reject(err);
      } else {
        resolve(row);
      }
      db.close();
    });
  });
}

// Get all tickets for a user
export function getUserTickets(userId: string): Promise<TicketRecord[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);

    db.all(
      'SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
      (err, rows: TicketRecord[]) => {
        if (err) {
          logger.error('Failed to get user tickets:', err);
          reject(err);
        } else {
          resolve(rows || []);
        }
        db.close();
      }
    );
  });
}
