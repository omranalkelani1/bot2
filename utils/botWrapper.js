// ================== BOT WRAPPER ==================
// دالة مركزية للتعامل مع Telegram API بأمان

const { delay } = require('../utils/helpers');

let _bot = null;

function init(botInstance) {
  _bot = botInstance;

  // تغليف editMessageText لتجاهل خطأ "message to edit not found"
  const _origEdit = _bot.editMessageText.bind(_bot);
  _bot.editMessageText = async (text, options = {}) => {
    try {
      return await _origEdit(text, options);
    } catch (err) {
      const desc = err?.response?.body?.description || err?.message || '';
      if (typeof desc === 'string' && desc.toLowerCase().includes('message to edit not found')) {
        console.warn('⚠️  editMessageText: message not found — ignored');
        return null;
      }
      console.error('editMessageText failed:', err?.response?.body ?? err);
      throw err;
    }
  };
}

/** إرسال رسالة بأمان مع retry */
async function safeSendMessage(chatId, text, options = {}, retry = 2) {
  try {
    return await _bot.sendMessage(chatId, text, options);
  } catch (err) {
    if (retry > 0) {
      await delay(1000);
      return safeSendMessage(chatId, text, options, retry - 1);
    }
    console.error('❌ sendMessage failed:', err?.response?.body ?? err.code);
  }
}

async function safeSendPhoto(chatId, photo, options) {
  try {
    return await _bot.sendPhoto(chatId, photo, options);
  } catch (e) {
    console.error(e);
  }
}

/** تعديل رسالة بأمان — يتجاهل "not modified" */
async function safeEditMessageText(text, options) {
  try {
    return await _bot.editMessageText(text, options);
  } catch (err) {
    const desc = err?.response?.body?.description ?? '';
    if (desc.includes('message is not modified')) return null;
    throw err;
  }
}

/** حذف رسالة بأمان */
async function safeDeleteMessage(chatId, messageId) {
  try {
    await _bot.deleteMessage(chatId, messageId);
  } catch (_) { /* تجاهل إذا لم توجد الرسالة */ }
}

/** الرد على callback_query بأمان */
async function safeAnswerCallback(queryId, text = '', showAlert = false) {
  try {
    await _bot.answerCallbackQuery(queryId, { text, show_alert: showAlert });
  } catch (e) {
    if (!e.message?.includes('query is too old')) {
      console.error('answerCallbackQuery failed:', e);
    }
  }
}

function getBot() { return _bot; }

module.exports = {
  init,
  getBot,
  safeSendMessage,
  safeEditMessageText,
  safeDeleteMessage,
  safeAnswerCallback,
  safeSendPhoto
};
