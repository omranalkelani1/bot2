// ================== TRADE SERVICE ==================

const store              = require('../state/store');
const { firebaseUpdate, firebaseRemove, firebasePush } = require('../firebaseHelpers');
const { safeSendMessage, safeEditMessageText, getBot } = require('../utils/botWrapper');
const { formatOffer, getPrice, delay, startOfferNowButton } = require('../utils/helpers');
const { finishOffer }    = require('./offerService');
const { process: env }   = require('../env');

const OFFERS_CHANNEL         = env.env.OFFERS_CHANNEL;
const CHECK_CHANNEL          = env.env.CHECK_CHANNEL;
const APPROVE_REJECT_CHANNEL = env.env.APPROVE_REJECT_CHANNEL;

// ─── cancelTrade ─────────────────────────────────────────────────────────────
async function cancelTrade(offerNumber) {
  if (!offerNumber) return;
  const offers  = store.getOffers();
  const trades  = store.getTrades();
  const { getOfferIdByNumber } = require('../utils/helpers');
  const offerId = getOfferIdByNumber(offerNumber, offers);
  if (!offerId) return;

  const offer = offers[offerId];
  const trade = trades[offerId];
  if (!offer || !trade) return;

  // رفع الحجز
  if (offer.locked) {
    offer.locked = false;
    delete offer.lockedBy;
    await firebaseUpdate(`bot_state/offers/${offerId}`, { locked: false, lockedBy: null });
  }

  await safeSendMessage(trade.buyerId,  `❌ تم إلغاء الصفقة رقم ${offer.number}`).catch(() => {});
  await safeSendMessage(trade.sellerId, `❌ تم إلغاء الصفقة رقم ${offer.number}`).catch(() => {});
  await safeSendMessage(APPROVE_REJECT_CHANNEL, `❌ تم إلغاء الصفقة رقم ${offer.number}`).catch(() => {});

  store.deleteTrade(offerId);
  await firebaseRemove(`bot_state/trades/${offerId}`);

  // إعادة زر الحجز لقناة العروض
  const bot = getBot();
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [[startOfferNowButton(offer.id)]] },
    { chat_id: OFFERS_CHANNEL, message_id: offer.publicMessageId }
  ).catch(() => {});
}

// ─── sendRatingRequest ───────────────────────────────────────────────────────
async function sendRatingRequest(chatId, targetUserId, offerId) {
  if (!chatId || !targetUserId || !offerId) return;
  const keyboard = [1, 2, 3, 4, 5].map(stars => ([{
    text:          '⭐'.repeat(stars),
    callback_data: `rate:${stars}:${targetUserId}:${offerId}`,
  }]));

  await safeSendMessage(chatId, '⭐️ كيف تقيّم التاجر الآخر؟', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

// ─── finalizeTrade ────────────────────────────────────────────────────────────
async function finalizeTrade(offer, chatId, messageId) {
  if (!offer) return;

  // const users  = store.getUsers();
  // const offers = store.getOffers();
  
  const trades = store.getTrades();
  const sellerUser = store.getUser(offer.userId);
  if (!sellerUser) return;

  const trade = trades[offer.id];
  if (!trade) return;

  const { buyerId, sellerId } = trade;
  const buyerUser  = store.getUser(buyerId);
  if (!buyerUser) return;

  // ── تحديث الإحصائيات ─────────────────────────────────────────────────────
  sellerUser.tradesCount = (sellerUser.tradesCount || 0) + 1;
  buyerUser.tradesCount  = (buyerUser.tradesCount  || 0) + 1;

  await firebaseUpdate(`bot_state/users/${sellerId}`, { tradesCount: sellerUser.tradesCount });
  await firebaseUpdate(`bot_state/users/${buyerId}`,  { tradesCount: buyerUser.tradesCount });
  await firebaseRemove(`bot_state/offers/${offer.id}`);
  await firebaseRemove(`bot_state/trades/${offer.id}`);

  // ── إثباتات الأدمن للمشتري ───────────────────────────────────────────────
  const bot = getBot();
  for (const p of (trade.adminProofs || [])) {
    await bot.sendPhoto(buyerId, p).catch(() => {});
    await delay(300);
  }

  // ── إثباتات المشتري للبائع ───────────────────────────────────────────────
  for (const p of (trade.buyerProofs || [])) {
    await bot.sendPhoto(sellerId, p).catch(() => {});
    await delay(300);
  }

  // ── تحديث القنوات ────────────────────────────────────────────────────────
  await finishOffer(offer);

  // ── الإشعارات ────────────────────────────────────────────────────────────
  await safeSendMessage(sellerId, `✅ تم تنفيذ الصفقة ${offer.number} بنجاح`);
  await safeSendMessage(buyerId,  `✅ تم تنفيذ الصفقة ${offer.number} بنجاح`);

  await safeEditMessageText(
    `✅ تم إغلاق الصفقة بنجاح\nرقم العرض: ${offer.number}`,
    { chat_id: chatId, message_id: messageId }
  );

  // ── طلب التقييم ──────────────────────────────────────────────────────────
  await sendRatingRequest(buyerId,  sellerId, offer.id).catch(e => console.error('rating error', e));
  await sendRatingRequest(sellerId, buyerId,  offer.id).catch(e => console.error('rating error', e));
}

module.exports = { cancelTrade, sendRatingRequest, finalizeTrade };
