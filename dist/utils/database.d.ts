export interface TicketRecord {
    id: number;
    channel_id: string;
    user_id: string;
    created_at: string;
    closed_at: string | null;
    transcript: string | null;
}
export declare function initDatabase(): Promise<void>;
export declare function createTicket(channelId: string, userId: string): Promise<void>;
export declare function closeTicket(channelId: string, transcript?: string): Promise<void>;
export declare function getTicketInfo(channelId: string): Promise<TicketRecord | undefined>;
export declare function getUserTickets(userId: string): Promise<TicketRecord[]>;
//# sourceMappingURL=database.d.ts.map