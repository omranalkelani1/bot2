// ================== COMMAND HANDLERS ==================

const store                  = require('../state/store');
const { firebaseUpdate, firebasePush, firebaseRemove } = require('../firebaseHelpers');
const { safeSendMessage, safeEditMessageText }    = require('../utils/botWrapper');
const { requireAdmin }       = require('../middleware/auth');
const { cancelTrade }        = require('../services/tradeService');
const { cancelOffer, finishAllOffers, sendOfferForReview } = require('../services/offerService');
const { getOfferIdByNumber, formatTradeStatus } = require('../utils/helpers');
const { process: env }       = require('../env');

const OFFERS_CHANNEL         = env.env.OFFERS_CHANNEL;
const CHECK_CHANNEL          = env.env.CHECK_CHANNEL;
// const START_BOT_PHOTO        = 'AgACAgQAAxkBAAIIUGl0Lub3v4UR_lQ8GOK1-7wy4QsSAAJIC2sbF3WhU19jqCKwW8bzAQADAgADeQADOAQ';
// const STOP_BOT_PHOTO         = 'AgACAgQAAxkBAAIIXGl0MeFscjjdJnAyfoY3oCsvutt7AAJLC2sbF3WhU2NIWAxFbmYGAQADAgADeAADOAQ';
const START_BOT_PHOTO        = 'AgACAgQAAxkBAAIC92nTN_olB13pL6zyFboXCtcOvgfuAAIHD2sbq5ShUoA1fEULDsEhAQADAgADeAADOwQ';
const STOP_BOT_PHOTO         = 'AgACAgQAAxkBAAIC-GnTOE6vfZh_v55nMI8yHhPn9bY-AAIID2sbq5ShUviAJMr1MtGAAQADAgADeAADOwQ';

function register(bot) {

  // /start
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const globals = store.getGlobals();
    const users   = store.getUsers();

    if (!globals.botEnabled || !globals.botAcceptingTrades) {
      return safeSendMessage(chatId, '🕑 البوت متوقف حاليا');
    }

    try {
      const member = await bot.getChatMember(OFFERS_CHANNEL, userId);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        return bot.sendMessage(chatId, '❌ يجب الانضمام للقناة: https://t.me/WWWEXZ');
      }
    } catch {
      return safeSendMessage(chatId, '❌ تأكد أنك مشترك بالقناة والبوت مشرف');
    }

    if (store.getUser(chatId)?.blocked) {
      return safeSendMessage(chatId, '⛔ حسابك مقفول، راجع المشرف');
    }

    if (!store.getUser(chatId)) {
      store.setUser(chatId, {
        phone: null, userId,
        current: { step: 'askPhone' },
        verify:  { step: null, photos: [] },
        tradesCount: 0,
        ratings: [],
        strikes: { count: 0, history: [] },
      });
    }

    if (!store.getUser(chatId).phone) {
      return safeSendMessage(chatId, '📱 الرجاء مشاركة رقم هاتفك', {
        reply_markup: {
          keyboard: [[{ text: 'مشاركة رقمي', request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard:   true,
        },
      });
    }

    const param = match?.[1];
    if (param?.startsWith('offer_')) {
      const offerId = Number(param.replace('offer_', ''));
      return startOfferFlow(chatId, offerId, bot);
    }

    return sendWelcomeMessage(chatId, msg);
  });

  // /tradeStatus<n>
  bot.onText(/\/tradeStatus(\d+)/, (msg, match) => {
    const chatId      = msg.chat.id;
    const offerNumber = Number(match[1]);
    const offers      = store.getOffers();
    const trades      = store.getTrades();
    const users       = store.getUsers();
    const offerId     = getOfferIdByNumber(offerNumber, offers);
    const offer       = offers[offerId];

    if (!offer || !trades[offer.id]) {
      return bot.sendMessage(chatId, '❌ الصفقة غير موجودة');
    }
    bot.sendMessage(chatId, formatTradeStatus(offer, trades, users), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔄 تحديث الحالة', callback_data: `trade_refresh_${offer.number}` },
        ]],
      },
    });
  });

  // /buyerCall<n>
  bot.onText(/\/buyerCall(\d+)/, (msg, match) => {
    const offers  = store.getOffers();
    const trades  = store.getTrades();
    const offerId = getOfferIdByNumber(Number(match[1]), offers);
    if (!offerId) return;
    const trade = trades[offerId];
    if (trade) safeSendMessage(trade.buyerId, 'السلام عليكم');
  });

  // /cancelTrade<n>
  bot.onText(/\/cancelTrade(\d+)\b/, async (msg, match) => {
    if (!await requireAdmin(msg, bot)) return;
    console.log(Number(match[1]));
    await cancelTrade(Number(match[1]));
  });

  // /cancelOffer<n>
  bot.onText(/\/cancelOffer(\d+)\b/, async (msg, match) => {
    if (!await requireAdmin(msg, bot)) return;
    await cancelOffer(Number(match[1]));
  });

  // /StartNow
  bot.onText(/\/StartNow\b/, async (msg) => {
    if (!await requireAdmin(msg, bot)) return;
    store.setGlobals({ botEnabled: true, botAcceptingTrades: true });
    await firebaseUpdate('bot_state/globals', { botEnabled: true, botAcceptingTrades: true });
    bot.sendPhoto(OFFERS_CHANNEL, START_BOT_PHOTO, {
      caption: '✅ تم تفعيل البوت\nأبدأ صفقتك معنا: @omran2002_bot',
    }).catch(() => {});
    bot.sendMessage(msg.chat.id, '✅ تم تشغيل البوت');
  });

  // /StopNow
  bot.onText(/\/StopNow\b/, async (msg) => {
    if (!await requireAdmin(msg, bot)) return;
    store.setGlobals({ botEnabled: false });
    await firebaseUpdate('bot_state/globals', { botEnabled: false });
    bot.sendPhoto(OFFERS_CHANNEL, STOP_BOT_PHOTO).catch(() => {});
    bot.sendMessage(msg.chat.id, '⛔ تم إيقاف البوت');
  });

  // /StopAcceptTrade
  bot.onText(/\/StopAcceptTrade\b/, async (msg) => {
    if (!await requireAdmin(msg, bot)) return;
    store.setGlobals({ botAcceptingTrades: false });
    await firebaseUpdate('bot_state/globals', { botAcceptingTrades: false });
    bot.sendMessage(msg.chat.id, '⛔ تم إيقاف قبول الصفقات');
  });

  // /FinishAllOffers
  bot.onText(/\/FinishAllOffers/, async (msg) => {
    bot.sendMessage(msg.chat.id, '⏳ Processing...');
    setImmediate(() => finishAllOffers());
  });
}

// ─── helpers used inside handlers ────────────────────────────────────────────

function startOfferFlow(chatId, offerId, bot) {
  const offers = store.getOffers();
  const offer  = offers[offerId];

  if (!offer) return safeSendMessage(chatId, '❌ العرض انتهى');
  if (offer.userId === chatId) return safeSendMessage(chatId, '❌ لا يمكنك حجز عرضك الخاص');

  const user   = store.getUser(chatId);
  user.current = { step: 'ask_quantity', offerId, offerOwnerId: offer.userId };

  safeSendMessage(chatId, `العرض الذي اخترته هو: ${offer.number}
📦 أدخل الكمية المطلوبة

الحد الأدنى: ${offer.minQuantity}
الحد الأعلى: ${offer.maxQuantity}`);
}

function sendWelcomeMessage(chatId, msg,isEdit = false) {
  const user     = store.getUser(chatId);
  const keyboard = [
    [{ text: '➕ إنشاء عرض USDT',    callback_data: JSON.stringify({ type: 'ways', data: 'create_usdt' }) }],
    [{ text: '📂 إدارة عروضي',        callback_data: JSON.stringify({ type: 'manage_offers' }) }],
    [{ text: '😎 ملفي الشخصي',        callback_data: JSON.stringify({ type: 'profile' }) }],
    [{ text: 'معلومات حول البوت',     callback_data: JSON.stringify({ type: 'info' }) }],
  ];
  if (!user?.verified) {
    keyboard.push([{ text: '🔐 توثيق الحساب', callback_data: JSON.stringify({ type: 'verify_me' }) }]);
  }
  baseText = `أهلاً بك يا ${msg.chat.first_name} في بوت alkelani p2p للوساطة المالية 🎯`;
  if(isEdit){
     safeEditMessageText(baseText, {
      chat_id: chatId,
      message_id: msg.message_id,
       parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    safeSendMessage(chatId, baseText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

module.exports = { register, sendWelcomeMessage, startOfferFlow };
