import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { mergeWithDefaults, normalizeConfig } from './validation';

export interface BotConfig {
  botName: string;
  avatar: string;
  embedColor: string;
  footerText: string;
  ticketCategory: string;
  supportRole: string;
}

const CONFIG_PERMISSIONS = 0o600;

export function loadConfig(): BotConfig {
  const configPath = path.join(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    logger.warn('config.json not found, using default config');
    const defaults = mergeWithDefaults(undefined);
    writeConfigFile(configPath, defaults);
    return defaults;
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(configData) as Partial<BotConfig>;
    return mergeWithDefaults(parsed);
  } catch (error) {
    logger.error('Failed to load config.json:', error);
    return mergeWithDefaults(undefined);
  }
}

export function saveConfig(config: BotConfig): boolean {
  const configPath = path.join(process.cwd(), 'config.json');
  const sanitizedConfig = normalizeConfig(config);

  try {
    writeConfigFile(configPath, sanitizedConfig);
    logger.info('Config saved successfully');
    return true;
  } catch (error) {
    logger.error('Failed to save config.json:', error);
    return false;
  }
}

function writeConfigFile(configPath: string, config: BotConfig) {
  const tempPath = `${configPath}.${process.pid}.tmp`;
  const content = `${JSON.stringify(config, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, content, { mode: CONFIG_PERMISSIONS });
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }

  try {
    fs.chmodSync(configPath, CONFIG_PERMISSIONS);
  } catch (error) {
    logger.warn('Unable to set secure permissions on config.json', error);
  }
}
