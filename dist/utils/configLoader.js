"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("./logger");
const validation_1 = require("./validation");
const CONFIG_PERMISSIONS = 0o600;
function loadConfig() {
    const configPath = path_1.default.join(process.cwd(), 'config.json');
    if (!fs_1.default.existsSync(configPath)) {
        logger_1.logger.warn('config.json not found, using default config');
        const defaults = (0, validation_1.mergeWithDefaults)(undefined);
        writeConfigFile(configPath, defaults);
        return defaults;
    }
    try {
        const configData = fs_1.default.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(configData);
        return (0, validation_1.mergeWithDefaults)(parsed);
    }
    catch (error) {
        logger_1.logger.error('Failed to load config.json:', error);
        return (0, validation_1.mergeWithDefaults)(undefined);
    }
}
function saveConfig(config) {
    const configPath = path_1.default.join(process.cwd(), 'config.json');
    const sanitizedConfig = (0, validation_1.normalizeConfig)(config);
    try {
        writeConfigFile(configPath, sanitizedConfig);
        logger_1.logger.info('Config saved successfully');
        return true;
    }
    catch (error) {
        logger_1.logger.error('Failed to save config.json:', error);
        return false;
    }
}
function writeConfigFile(configPath, config) {
    const tempPath = `${configPath}.${process.pid}.tmp`;
    const content = `${JSON.stringify(config, null, 2)}\n`;
    try {
        fs_1.default.writeFileSync(tempPath, content, { mode: CONFIG_PERMISSIONS });
        fs_1.default.renameSync(tempPath, configPath);
    }
    catch (error) {
        if (fs_1.default.existsSync(tempPath)) {
            fs_1.default.unlinkSync(tempPath);
        }
        throw error;
    }
    try {
        fs_1.default.chmodSync(configPath, CONFIG_PERMISSIONS);
    }
    catch (error) {
        logger_1.logger.warn('Unable to set secure permissions on config.json', error);
    }
}
//# sourceMappingURL=configLoader.js.map