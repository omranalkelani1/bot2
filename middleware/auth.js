// ================== AUTH MIDDLEWARE ==================
// التحقق من صلاحيات الأدمن بطريقة مركزية

const { getBot }       = require('../utils/botWrapper');
const { env } = require('../env');
const CHECK_CHANNEL = process.env.CHECK_CHANNEL;

/**
 * يتحقق أن المرسل أدمن أو مالك قناة CHECK_CHANNEL
 * @returns {boolean}
 */
async function isAdmin(userId) {
  try {
    const bot    = getBot();
    const member = await bot.getChatMember(CHECK_CHANNEL, userId);
    return member && ['administrator', 'creator'].includes(member.status);
  } catch (e) {
    console.error('isAdmin check failed:', e?.message);
    return false;
  }
}

/**
 * Middleware للاستخدام في command handlers
 * يُرسل رسالة خطأ ويعيد false إذا لم يكن المستخدم أدمن
 */
async function requireAdmin(msg, bot) {
  const chatId = msg.chat.id;
  const ok     = await isAdmin(msg.from.id);
  if (!ok) {
    await bot.sendMessage(chatId, '❌ غير مصرح');
  }
  return ok;
}

module.exports = { isAdmin, requireAdmin };
