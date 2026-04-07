// ================== UTILITIES ==================

const { transform_way } = require('../config/constants');

/** تحقق من أن القيمة رقم صحيح */
function isValidNumber(value) {
  return value !== '' && value !== null && value !== undefined && !isNaN(value);
}

/** تأخير بالميلي ثانية */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** تحويل Firebase object إلى array بأمان */
function asArray(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  return Object.values(obj);
}

/** حساب السعر الكلي */
function getPrice(price, qty) {
  return (Number(price) * Number(qty)).toFixed(2);
}

/** متوسط التقييم */
function getAvgRating(user) {
  if (!user?.ratings?.length) return 'لا يوجد';
  const sum = user.ratings.reduce((a, b) => a + Number(b.rate), 0);
  return (sum / user.ratings.length).toFixed(1);
}

/** فئة المستخدم بناءً على عدد المعاملات */
function getCategory(tradesCount = 0) {
  if (tradesCount >= 50) return 'أسطوري 🔥';
  if (tradesCount >= 30) return 'ملكي 👑';
  if (tradesCount >= 15) return 'ذهبي 🥇';
  if (tradesCount >= 5) return 'فضي 🥈';
  return 'برونزي 🥉';
}

/** البحث عن offerId بواسطة رقم العرض */
function getOfferIdByNumber(number, offers) {
  for (const oId in offers) {
    if (+offers[oId].number === +number) return offers[oId].id;
  }
  return undefined;
}
function getOfferIdByUser(userId, offers, trades) {
  const uploadSteps = [
    'seller_upload', 'buyer_upload', 'admin_upload',
    'seller_payment_info', 'buyer_payment_info'
  ];

  for (const offerId in trades) {
    const trade = trades[offerId];

    // هل المستخدم طرف في هذه الصفقة؟
    const isParty = trade.sellerId === userId || trade.buyerId === userId;

    // هل الصفقة في مرحلة تتطلب رفع من هذا المستخدم؟
    const isActiveStep = uploadSteps.includes(trade.step);

    if (isParty && isActiveStep) return offerId;
  }
  return undefined;
}

/** إضافة strike للمستخدم */
function addStrike(user) {
  const now = Date.now();
  user.strikes = user.strikes || { count: 0, history: [] };
  user.strikes.history.push(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  user.strikes.history = user.strikes.history.filter(t => t >= weekAgo);
  user.strikes.count = user.strikes.history.length;
  if (user.strikes.count >= 5) user.blocked = true;
}

// ================== FORMATTERS ==================

function formatOffer(user, offer, statusText = '', isCenterLine = false, viewName = false) {
  const text = `
📩 العرض رقم: ${offer.number}\n
🔁 التاجر يريد: ${offer.operation} USDT ${offer.operation === 'بيع' ? '🔴' : '🟢'}
📦 الكمية: ${offer.minQuantity} الى ${offer.maxQuantity}
💰 السعر: ${offer.price}
💳 طريقة الدفع: ${transform_way[offer.transform_way]}
 _____________________
${user?.verified ? '✅ حساب موثق' : ''}
💼 فئة التاجر: ${getCategory(user?.tradesCount)}
✨ السمعة: ${getAvgRating(user)}/5
👍 معاملات ناجحة: ${user?.tradesCount > 0 ? user.tradesCount : 'جديد'}
عمولة الوسيط : 0.25$
${statusText}
${viewName ? `الاسم: ${(user?.first_name ?? '') + ' ' + (user?.last_name ?? '')}
الرقم: +${user?.phone}` : ''}
`;
  return isCenterLine ? `<s>${text}</s>\n❌ تم إغلاق العرض` : text;
}

function formatPreview(offer, title = '📋 *تأكيد بيانات العرض*') {
  return `
${title}

🔁 العملية: ${offer.operation} USDT ${offer.operation === 'بيع' ? '🔴' : '🟢'}
💰 السعر: ${offer.price}
📦 الكمية: ${offer.minQuantity} الى ${offer.maxQuantity}
💳 طريقة الدفع: ${transform_way[offer.transform_way]}
`;
}

function formatTradeStatus(offer, trades, userStates) {
  if (!offer) return '';
  const trade = trades[offer.id];
  if (!trade) return '';
  const { TradeStepsAR } = require('../config/constants');
  const stepText = TradeStepsAR[trade.step] || 'غير معروف';
  return `
🧾 عرض رقم: ${offer.number}
━━━━━━━━━━━━
👤 البائع: +${userStates[trade.sellerId]?.phone}
👤 المشتري: +${userStates[trade.buyerId]?.phone}

📍 الحالة الحالية:
➡️ ${stepText}

${trade.step}
`;
}

/** زر "احجز الآن" للقناة */
function startOfferNowButton(offerId) {
  return {
    text: '▶️ احجز الآن',
    url: `https://t.me/testOmran_bot?start=offer_${offerId}`,
  };
}
module.exports = {
  isValidNumber,
  delay,
  asArray,
  getPrice,
  getAvgRating,
  getCategory,
  getOfferIdByNumber,
  getOfferIdByUser,
  addStrike,
  formatOffer,
  formatPreview,
  formatTradeStatus,
  startOfferNowButton,
};
