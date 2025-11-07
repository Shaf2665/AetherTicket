"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConfig = normalizeConfig;
exports.mergeWithDefaults = mergeWithDefaults;
exports.redactSecret = redactSecret;
const DEFAULTS = {
    botName: 'AetherTicket',
    avatar: './avatar.png',
    embedColor: '#5865F2',
    footerText: 'Powered by AetherPanel',
    ticketCategory: 'Support Tickets',
    supportRole: 'Support',
};
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\0-\x1F\x7F]/g;
const MULTIPLE_SPACES = /\s{2,}/g;
function sanitizeText(value, maxLength, allowSymbols = true) {
    if (typeof value !== 'string') {
        return '';
    }
    let sanitized = value.replace(CONTROL_CHARACTERS, ' ').trim();
    sanitized = sanitized.normalize('NFKC');
    if (!allowSymbols) {
        sanitized = sanitized.replace(/[^A-Za-z0-9 _-]/g, '');
    }
    sanitized = sanitized.replace(MULTIPLE_SPACES, ' ');
    if (sanitized.length > maxLength) {
        sanitized = sanitized.slice(0, maxLength);
    }
    return sanitized;
}
function sanitizeHexColor(value) {
    if (typeof value !== 'string') {
        return DEFAULTS.embedColor;
    }
    const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) {
        return DEFAULTS.embedColor;
    }
    return `#${match[1].toUpperCase()}`;
}
function normalizeConfig(input) {
    const sanitized = {
        botName: sanitizeText(input.botName ?? DEFAULTS.botName, 32),
        avatar: input.avatar && typeof input.avatar === 'string' ? input.avatar : DEFAULTS.avatar,
        embedColor: sanitizeHexColor(input.embedColor ?? DEFAULTS.embedColor),
        footerText: sanitizeText(input.footerText ?? DEFAULTS.footerText, 128),
        ticketCategory: sanitizeText(input.ticketCategory ?? DEFAULTS.ticketCategory, 64, false),
        supportRole: sanitizeText(input.supportRole ?? DEFAULTS.supportRole, 64, false),
    };
    return sanitized;
}
function mergeWithDefaults(input) {
    if (!input) {
        return DEFAULTS;
    }
    return normalizeConfig({ ...DEFAULTS, ...input });
}
function redactSecret(value) {
    if (!value) {
        return '<empty>';
    }
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
//# sourceMappingURL=validation.js.map