// ================== OFFER SERVICE ==================

const store = require('../state/store');
const { firebaseUpdate, firebaseRemove, firebasePush } = require('../firebaseHelpers');
const { safeSendMessage, safeEditMessageText } = require('../utils/botWrapper');
const { formatOffer, formatPreview, startOfferNowButton, getAvgRating, getCategory } = require('../utils/helpers');
const { callbackTypes, transform_way } = require('../config/constants');
// const { process } = require('../env');
// const env = process.env
const OFFERS_CHANNEL = env.OFFERS_CHANNEL;
const CHECK_CHANNEL = env.CHECK_CHANNEL;
const APPROVE_REJECT_CHANNEL = env.APPROVE_REJECT_CHANNEL;

// ─── findMatchingOffers ───────────────────────────────────────────────────────
function findMatchingOffers(newOffer) {
  if (!newOffer) return [];
  const offers = store.getOffers();
  const matches = [];

  for (const offerId in offers) {
    const offer = offers[offerId];
    if (offer.userId === newOffer.userId) continue;
    if (offer.transform_way !== newOffer.transform_way) continue;
    if (offer.operation === newOffer.operation) continue;
    if (offer.locked) continue;

    const qtyOk =
      Number(newOffer.minQuantity) <= Number(offer.maxQuantity) &&
      Number(newOffer.maxQuantity) >= Number(offer.minQuantity);
    if (!qtyOk) continue;

    const priceOk =
      newOffer.operation === 'بيع'
        ? Number(newOffer.price) <= Number(offer.price)
        : Number(newOffer.price) >= Number(offer.price);
    if (!priceOk) continue;

    matches.push(offer);
  }
  return matches;
}

// ─── finishOffer ─────────────────────────────────────────────────────────────
async function finishOffer(offer) {
  if (!offer) return;
  const user = store.getUser(offer.userId);
  const users = store.getUsers();

  await safeEditMessageText(formatOffer(user, offer, '', true, true), {
    chat_id: CHECK_CHANNEL,
    message_id: offer.checkMessageId,
    parse_mode: 'HTML',
  });

  if (offer.publicMessageId) {
    await safeEditMessageText(formatOffer(user, offer, '', true), {
      chat_id: OFFERS_CHANNEL,
      message_id: offer.publicMessageId,
      parse_mode: 'HTML',
    });
  }
}

// ─── approveOfferProcess ─────────────────────────────────────────────────────
async function approveOfferProcess(userId, offerId, query) {
  const globals = store.getGlobals();
  const users = store.getUsers();
  const offers = store.getOffers();
  const user = store.getUser(userId);
  const offer = offers[offerId];

  if (!user || !offer || offer.status !== 'pending') return;

  // تعيين رقم العرض
  const newSeq = (globals.offerSeq || 0) + 1;
  store.setGlobals({ offerSeq: newSeq });
  offer.status = 'approved';
  offer.number = newSeq;
  if (!offer.transform_way || !offer.price || !offer.minQuantity || !offer.maxQuantity) {
    await safeEditMessageText(`❌ فشل الموافقة: تأكد من ملء جميع بيانات العرض بشكل صحيح`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
    });
    await firebaseRemove(`bot_state/offers/${offerId}`);
    return
  }
  await firebaseUpdate(`bot_state/offers/${offerId}`, { number: offer.number, status: 'approved' });
  await firebaseUpdate(`bot_state/globals`, { offerSeq: newSeq });

  await safeEditMessageText(`✅ تم قبول عرضك ونشره\nرقم العرض هو: ${offer.number}`,
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
    });

  const pubMsg = await safeSendMessage(
    OFFERS_CHANNEL,
    formatOffer(user, offer),
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[startOfferNowButton(offer.id)]] },
    }
  );

  if (pubMsg) {
    offer.publicMessageId = pubMsg.message_id;
    await firebaseUpdate(`bot_state/offers/${offerId}`, { publicMessageId: offer.publicMessageId });
  }

  // البحث عن عروض مطابقة
  const matches = findMatchingOffers(offer);
  for (const matchedOffer of matches) {
    offer.matchedWith = matchedOffer.id;
    matchedOffer.matchedWith = offer.id;
    const matchUser = store.getUser(matchedOffer.userId);
    await safeSendMessage(
      userId,
      `🎯 تم العثور على عرض مطابق:\n\n${formatOffer(matchUser, matchedOffer)}`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[startOfferNowButton(matchedOffer.id)]] },
      }
    );
  }
}

// ─── sendOfferForReview ──────────────────────────────────────────────────────
async function sendOfferForReview(userId, query) {
  const globals = store.getGlobals();
  const user = store.getUser(userId);

  if (!globals.botEnabled) {
    await safeSendMessage(userId, '⛔ البوت متوقف مؤقتاً. حاول لاحقاً.');
    return;
  }
  if (!user) return;

  const num = (globals.forwardingNum || 0) + 1;
  store.setGlobals({ forwardingNum: num });
  await firebaseUpdate(`bot_state/globals`, { forwardingNum: num });

  const offerId = num;
  const offer = {
    id: offerId,
    ...user.current,
    status: 'pending',
    userId: userId,
    checkMessageId: null,
    publicMessageId: null,
    matchedWith: null,
    rated: false,
  };

  store.setOffer(offerId, offer);
  user.current = {};

  const sent = await safeSendMessage(
    CHECK_CHANNEL,
    formatOffer(user, offer, '', false, true)
  );

  if (sent) {
    offer.checkMessageId = sent.message_id;
  }

  await firebasePush(`bot_state/offers/${offer.id}`, { ...offer }, true);

  // تشغيل عملية الموافقة
  await approveOfferProcess(userId, offerId, query);
}

// ─── cancelOffer ─────────────────────────────────────────────────────────────
async function cancelOffer(offerNumber) {
  try {
    if (!offerNumber) return;
    const offers = store.getOffers();
    const { getOfferIdByNumber } = require('../utils/helpers');
    const offerId = getOfferIdByNumber(offerNumber, offers);
    if (!offerId) return;

    const offer = offers[offerId];
    if (!offer) return;

    await safeSendMessage(offer.userId, `❌ تم إلغاء العرض رقم ${offer.number}`);
    await safeSendMessage(APPROVE_REJECT_CHANNEL, `❌ تم إلغاء العرض رقم ${offer.number}`);
    await finishOffer(offer);

    store.deleteOffer(offerId);
    await firebaseRemove(`bot_state/offers/${offerId}`);
  } catch (err) {
    console.error('cancelOffer error:', err);
  }
}

// ─── finishAllOffers ─────────────────────────────────────────────────────────
async function finishAllOffers() {
  const offers = store.getOffers();
  for (const offer of Object.values(offers)) {
    await finishOffer(offer);
  }

  // مسح جميع العروض من الذاكرة
  for (const id in offers) store.deleteOffer(id);

  await safeSendMessage(
    OFFERS_CHANNEL,
    '🎯🎯 تم إغلاق جميع العروض القديمة لضبط حركة السوق اليومية'
  );
}

module.exports = {
  findMatchingOffers,
  finishOffer,
  approveOfferProcess,
  sendOfferForReview,
  cancelOffer,
  finishAllOffers,
};
