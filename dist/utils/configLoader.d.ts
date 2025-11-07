export interface BotConfig {
    botName: string;
    avatar: string;
    embedColor: string;
    footerText: string;
    ticketCategory: string;
    supportRole: string;
}
export declare function loadConfig(): BotConfig;
export declare function saveConfig(config: BotConfig): boolean;
//# sourceMappingURL=configLoader.d.ts.map