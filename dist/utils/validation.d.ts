import { BotConfig } from './configLoader';
export declare function normalizeConfig(input: Partial<BotConfig>): BotConfig;
export declare function mergeWithDefaults(input: Partial<BotConfig> | undefined): BotConfig;
export declare function redactSecret(value: string | undefined): string;
//# sourceMappingURL=validation.d.ts.map