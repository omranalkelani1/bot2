// ================== MAIN ENTRY POINT ==================
// index.js — نقطة الدخول الرئيسية

const TelegramBot = require('node-telegram-bot-api');
// const {process} = require('./env');
// const env = process.env
const botWrapper       = require('./utils/botWrapper');
const { initStorage }  = require('./services/storageLoader');
const commandHandlers  = require('./handlers/commandHandlers');
const messageHandlers  = require('./handlers/messageHandlers');
const callbackHandlers = require('./handlers/callbackHandlers');

// ─── تهيئة البوت ──────────────────────────────────────────────────────────
const bot = new TelegramBot(env.BOT_TOKEN, { polling: true });

bot.setMyCommands([
  { command: 'start', description: 'بدء استخدام البوت' },
]);

// ─── تهيئة الـ wrapper (يُغلّف editMessageText أيضاً) ────────────────────
botWrapper.init(bot);

console.log('✅ Bot is running.......');

// ─── تسجيل الـ handlers ───────────────────────────────────────────────────
commandHandlers.register(bot);
messageHandlers.register(bot);
callbackHandlers.register(bot);

// ─── تحميل البيانات من Firebase ──────────────────────────────────────────
initStorage();
