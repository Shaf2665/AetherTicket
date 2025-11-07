import { Collection } from 'discord.js';
import type { CommandModule } from './command';

declare module 'discord.js' {
  interface Client {
    commands?: Collection<string, CommandModule>;
  }
}
