import { Telegraf } from "telegraf";

export const token = process.env.TELEGRAM_TOKEN!;
export const bot = new Telegraf(token);
