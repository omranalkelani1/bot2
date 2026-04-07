// ================== CALLBACK HANDLERS ==================

const store = require('../state/store');
const { firebaseUpdate, firebaseRemove, firebasePush } = require('../firebaseHelpers');
const {
  safeSendMessage, safeEditMessageText, safeSendPhoto,
  safeDeleteMessage, safeAnswerCallback, getBot,
} = require('../utils/botWrapper');
const {
  formatOffer, formatPreview, formatTradeStatus,
  getPrice, getCategory, getAvgRating,
  getOfferIdByNumber, startOfferNowButton, delay,
} = require('../utils/helpers');
const { handleAddressCallbacks, sendAddressPicker } = require('../services/addressService');
const { callbackTypes, transform_way, offerStatus } = require('../config/constants');
const { sendOfferForReview, finishOffer, cancelOffer } = require('../services/offerService');
const { cancelTrade, finalizeTrade, sendRatingRequest } = require('../services/tradeService');
const { sendWelcomeMessage } = require('./commandHandlers');
const OFFERS_CHANNEL = process.env.OFFERS_CHANNEL;
const CHECK_CHANNEL = process.env.CHECK_CHANNEL;
const APPROVE_REJECT_CHANNEL = process.env.APPROVE_REJECT_CHANNEL;

function register(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;  // ✅ Bug مُصلح: نعرّفه أولاً
    const answer = (text = '', showAlert = false) => safeAnswerCallback(query.id, text, showAlert);
    const globals = store.getGlobals();

    if (await handleAddressCallbacks(query, query.data)) return;
    // ── trade_refresh ──────────────────────────────────────────────────────
    if (query.data.startsWith('trade_refresh_')) {
      const offerNumber = Number(query.data.split('_')[2]);
      const offers = store.getOffers();
      const trades = store.getTrades();
      const users = store.getUsers();
      const offerId = getOfferIdByNumber(offerNumber, offers);
      const offer = offers[offerId];
      if (!offer) return;
      await safeEditMessageText(formatTradeStatus(offer, trades, users), {
        chat_id: chatId, message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔄 تحديث الحالة', callback_data: `trade_refresh_${offer.number}` }]] },
      });
      return answer();
    }

    // ── Bot disabled guard ─────────────────────────────────────────────────
    if (!globals.botEnabled || !globals.botAcceptingTrades) {
      return safeSendMessage(chatId, '🕑 البوت متوقف حاليا');
    }

    // ── rating ─────────────────────────────────────────────────────────────
    if (query.data.startsWith('rate:')) {
      const [, rate, targetUser, offerId] = query.data.split(':');
      const target = store.getUser(targetUser);
      if (!target) return;
      const rating = { from: query.from.id, rate: Number(rate), date: Date.now() };
      target.ratings = target.ratings || [];
      target.ratings.push(rating);
      await firebasePush(`bot_state/users/${targetUser}/ratings`, rating);
      await safeEditMessageText('✅ شكراً لتقييمك', { chat_id: chatId, message_id: query.message.message_id });
      return sendWelcomeMessage(chatId, query.message);
    }

    // ── Parse JSON payload ─────────────────────────────────────────────────
    let payload;
    try { payload = JSON.parse(query.data); } catch { return; }

    const offers = store.getOffers();
    const trades = store.getTrades();
    const users = store.getUsers();

    // ── confirm_send ───────────────────────────────────────────────────────
    if (payload.type === callbackTypes.confirm_send) {
      return sendOfferForReview(chatId, query);
    }

    // ── verify_me ──────────────────────────────────────────────────────────
    if (payload.type === callbackTypes.verify_me) {
      const user = store.getUser(query.from.id);
      if (!user) return;
      user.verify = { step: 'waiting_photos', photos: [] };
      await firebaseUpdate(`bot_state/users/${query.from.id}/verify`, { step: 'waiting_photos' });
      await safeSendMessage(query.from.id,
        '📸 أرسل صور الهوية\n\nعند الانتهاء اضغط زر *تأكيد رفع الثبوتيات*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ تأكيد', callback_data: JSON.stringify({ type: callbackTypes.verify_confirm }) },
              { text: '❌ إلغاء', callback_data: JSON.stringify({ type: 'verify_cancel' }) },
            ]],
          },
        }
      );
      return answer();
    }

    if (payload.type === 'verify_cancel') {
      const user = store.getUser(query.from.id);
      if (!user) return;
      user.verify = { step: null, photos: [] };
      await firebaseUpdate(`bot_state/users/${query.from.id}/verify`, { step: null, photos: [] });
      await safeSendMessage(query.from.id, '❌ تم إلغاء عملية التوثيق');
      await safeDeleteMessage(chatId, query.message.message_id);
      return answer();
    }

    if (payload.type === callbackTypes.verify_confirm) {
      const userId = query.from.id;
      const user = store.getUser(userId);
      if (!user?.verify?.photos?.length) return answer('❗ لم تقم برفع أي صورة', true);

      await safeSendMessage(CHECK_CHANNEL, `🔐 طلب توثيق\n👤 ${user.first_name}\n📞 +${user.phone}`);
      for (const photoId of user.verify.photos) {
        await bot.sendPhoto(CHECK_CHANNEL, photoId);
        await delay(300);
      }
      await safeSendMessage(CHECK_CHANNEL, 'اختر الإجراء:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ قبول التوثيق', callback_data: JSON.stringify({ type: callbackTypes.verify_approve, userId }) },
            { text: '❌ رفض', callback_data: JSON.stringify({ type: callbackTypes.verify_reject, userId }) },
          ]],
        },
      });
      user.verify.step = 'confirm';
      await firebaseUpdate(`bot_state/users/${userId}/verify`, { step: 'confirm' });
      await safeEditMessageText('⏳ تم إرسال الثبوتيات للمراجعة', { chat_id: chatId, message_id: query.message.message_id })
        .catch(() => safeSendMessage(userId, '⏳ تم إرسال الثبوتيات للمراجعة'));
    }

    if (payload.type === callbackTypes.verify_approve) {
      const user = store.getUser(payload.userId);
      if (!user) return;
      user.verified = true;
      user.verify.step = null;
      await firebaseUpdate(`bot_state/users/${payload.userId}`, { verified: true, 'verify/step': null });
      await safeEditMessageText('✅ تم قبول توثيق الحساب', { chat_id: chatId, message_id: query.message.message_id });
      await safeSendMessage(payload.userId, '✅ تم توثيق حسابك بنجاح');
      return answer('تم قبول التوثيق');
    }

    if (payload.type === callbackTypes.verify_reject) {
      const user = store.getUser(payload.userId);
      if (!user) return;
      user.verified = false;
      user.verify = { step: null, photos: [] };
      await firebaseUpdate(`bot_state/users/${payload.userId}`, { verified: false, verify: { step: null, photos: [] } });
      await safeEditMessageText('❌ تم رفض توثيق الحساب', { chat_id: chatId, message_id: query.message.message_id });
      await safeSendMessage(payload.userId, '❌ تم رفض التوثيق، يرجى إعادة رفع صور أوضح');
      return answer('تم الرفض');
    }

    // ── sellOrBuy ──────────────────────────────────────────────────────────
    if (payload.type === callbackTypes.sellOrBuy) {
      const user = store.getUser(chatId);
      if (!user) return answer('❌ خطأ');
      user.current = { operation: payload.data === 'sell' ? 'بيع' : 'شراء', step: 'askTransform_way' };
      await firebaseUpdate(`bot_state/users/${chatId}`, { current: { ...user.current } });
      return safeEditMessageText(`اختر طريقة ${user.current.operation === 'بيع' ? 'الاستلام' : 'الدفع'}`, {
        chat_id: chatId, message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: Object.entries(transform_way).map(([k, v]) => [
            { text: v, callback_data: JSON.stringify({ type: callbackTypes.transform_way, data: k }) },
          ]),
        },
      });
    }

    // ── transform_way ──────────────────────────────────────────────────────
    if (payload.type === callbackTypes.transform_way) {
      const state = store.getUser(chatId)?.current;
      if (!state) return;

      if (state.editDraft) {
        state.editDraft.transform_way = payload.data;
        await firebaseUpdate(`bot_state/users/${chatId}/current/editDraft`, { transform_way: payload.data });
        await safeSendMessage(chatId, formatPreview(state.editDraft), {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ إرسال التعديل للمشرف', callback_data: JSON.stringify({ type: callbackTypes.submit_edit, offerId: state.editingOfferId }) }],
              [{ text: '❌ إلغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer }) }],
            ],
          },
        });
        return answer();
      }

      state.transform_way = payload.data;
      state.step = 'askMinQuantity';
      await firebaseUpdate(`bot_state/users/${chatId}/current`, { transform_way: state.transform_way, step: state.step });
      return safeEditMessageText(
        `تم حفظ طريقة ${state.operation === 'بيع' ? 'الاستلام' : 'الدفع'}: ${transform_way[state.transform_way]}\nأدخل الحد الأدنى للكمية`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' }
      );
    }

    // ── cancel_quantity ────────────────────────────────────────────────────
    if (payload.type === 'cancel_quantity') {
      const user = store.getUser(query.from.id);
      if (user) user.current.step = 'ask_quantity';
      await safeDeleteMessage(chatId, query.message.message_id);
      return answer('ادخل الكمية من جديد');
    }

    // ── cancel_offer ───────────────────────────────────────────────────────
    if (payload.type === callbackTypes.cancel_offer) {
      const user = store.getUser(query.from.id);
      if (user) user.current = {};
      await safeEditMessageText('❌ تم إلغاء إنشاء العرض', { chat_id: chatId, message_id: query.message.message_id });
      return answer();
    }

    // ── edit_offer ─────────────────────────────────────────────────────────
    if (payload.type === callbackTypes.edit_offer) {
      const user = store.getUser(query.from.id);
      const offer = offers[payload.offerId];
      if (!user || !offer) return answer('❌ خطأ');
      user.current = { step: 'editing_offer', editingOfferId: payload.offerId, editDraft: { ...offer } };
      await firebaseUpdate(`bot_state/users/${query.from.id}/current`, {
        step: user.current.step, editingOfferId: payload.offerId,
      });
      await safeSendMessage(query.from.id, `🔧 تعديل العرض رقم ${offer.number}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ تعديل السعر', callback_data: JSON.stringify({ type: callbackTypes.edit_price, offerId: payload.offerId }) }],
            [{ text: '🔢 تعديل الكمية', callback_data: JSON.stringify({ type: callbackTypes.edit_quantity, offerId: payload.offerId }) }],
            [{ text: '💳 تعديل طرق الدفع', callback_data: JSON.stringify({ type: callbackTypes.edit_transform_way, offerId: payload.offerId }) }],
            [{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'back' }) }],
          ],
        },
      });
      return answer();
    }

    if (payload.type === callbackTypes.edit_price) {
      const user = store.getUser(query.from.id);
      if (!user) return answer('❌ خطأ');
      user.current = { ...user.current, step: 'editPrice', editingOfferId: payload.offerId };
      await firebaseUpdate(`bot_state/users/${query.from.id}/current`, { step: 'editPrice', editingOfferId: payload.offerId });
      await safeSendMessage(query.from.id, 'أرسل السعر الجديد (عدد فقط)');
      return answer();
    }

    if (payload.type === callbackTypes.edit_quantity) {
      const user = store.getUser(query.from.id);
      if (!user) return answer('❌ خطأ');
      user.current = { ...user.current, step: 'editQuantity', editingOfferId: payload.offerId };
      await firebaseUpdate(`bot_state/users/${query.from.id}/current`, { step: 'editQuantity', editingOfferId: payload.offerId });
      await safeSendMessage(query.from.id, 'أرسل الحد الأدنى والأقصى مفصولين بمسافة (مثال: 1 10)');
      return answer();
    }

    if (payload.type === callbackTypes.edit_transform_way) {
      const keyboard = Object.entries(transform_way).map(([k, v]) => [
        { text: v, callback_data: JSON.stringify({ type: callbackTypes.transform_way, data: k }) },
      ]);
      await safeSendMessage(query.from.id, 'اختر طريقة الدفع الجديدة:', { reply_markup: { inline_keyboard: keyboard } });
      return answer();
    }

    // ── submit_edit ────────────────────────────────────────────────────────
    if (payload.type === callbackTypes.submit_edit) {
      const userId = query.from.id;
      const user = store.getUser(userId);
      if (!user?.current?.editDraft) return answer('❌ لا يوجد تعديل');

      if (payload.offerId) {
        const oldOffer = offers[payload.offerId];
        const result = await firebaseRemove(`bot_state/offers/${payload.offerId}`);
        if (result) {
          await finishOffer(oldOffer);
          store.deleteOffer(payload.offerId);
        }
        return answer();
      }

      const draft = user.current.editDraft;
      ['id', 'status', 'userId', 'checkMessageId', 'publicMessageId', 'matchedWith', 'rated', 'trade', 'number']
        .forEach(k => delete draft[k]);
      user.current = draft;
      await firebaseUpdate(`bot_state/users/${userId}`, { current: user.current });
      await sendOfferForReview(chatId, query);
      return answer('✅ تم إنشاء عرض جديد');
    }

    // ── confirm_quantity ───────────────────────────────────────────────────
    if (payload.type === 'confirm_quantity') {
      const userId = query.from.id;
      const buyer = store.getUser(userId);
      if (!buyer?.current) return;

      const { offerId, offerOwnerId, quantity } = buyer.current;
      if (!offerId || !offerOwnerId || !quantity) return answer('❌ بيانات غير مكتملة');

      const seller = store.getUser(offerOwnerId);
      const offer = offers[offerId];
      if (!offer || offer.status === 'done' || offer.status === 'rejected') return answer('❌ العرض غير متاح');
      if (offer.locked) return answer('❌ العرض محجوز حالياً');

      const globals = store.getGlobals();
      const newTradeId = (globals.tradeId || 0) + 1;
      store.setGlobals({ tradeId: newTradeId });

      const isOfferSell = offer.operation === 'بيع';
      const trade = {
        tradeId: newTradeId,
        buyerId: isOfferSell ? userId : offerOwnerId,
        sellerId: isOfferSell ? offerOwnerId : userId,
        quantity,
        step: 'owner_pending_accept',
        sellerProofs: [],
        buyerProofs: [],
        adminProofs: [],
        createdAt: Date.now(),
      };

      store.setTrade(offerId, trade);
      buyer.current = {};
      await firebaseUpdate(`bot_state/trades`, { [offer.id]: trade });

      await getBot().editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: OFFERS_CHANNEL, message_id: offer.publicMessageId,
      }).catch(() => { });

      await safeSendMessage(userId, `✅ تم تأكيد الكمية بنجاح\n📦 الكمية: ${quantity}\n⏳ طلبك قيد المراجعة`);
      await safeSendMessage(APPROVE_REJECT_CHANNEL,
        `📣 صفقة جديدة\nرقم العرض: ${offer.number}\nصاحب العرض: +${seller?.phone}`);
      await safeSendMessage(offerOwnerId,
        `📣🔥 لديك صفقة جديدة\nرقم العرض: ${offer.number}\n📦 الكمية: ${quantity}\n\nهل تقبل؟`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ قبول الصفقة', callback_data: JSON.stringify({ type: callbackTypes.seller_accept_trade, offerId: offer.id }) },
              { text: '❌ رفض الصفقة', callback_data: JSON.stringify({ type: callbackTypes.seller_reject_trade, offerId: offer.id }) },
            ]],
          },
        }
      );
      await safeDeleteMessage(userId, query.message.message_id);
      return answer('تم تأكيد الكمية');
    }

    // ── seller_accept_trade ────────────────────────────────────────────────
    if (payload.type === callbackTypes.seller_accept_trade) {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');
      if (query.from.id !== offer.userId) return answer('❌ غير مصرح');

      trade.step = 'seller_upload';
      offer.locked = true;
      offer.lockedBy = query.from.id;

      await firebaseUpdate(`bot_state/offers/${offerId}`, { locked: true, lockedBy: query.from.id });
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });

      await safeSendMessage(trade.sellerId,
        `📤 الرجاء إرسال إثباتات التحويل (صور فقط)\n\nالكمية: ${(+trade.quantity + 0.25).toFixed(2)} USDT\nستستلم: ${getPrice(offer.price, trade.quantity)}\n\nعنوان المحفظة:\n<code>${env.PAYMENT || 'غير معرف'}</code>\nعبر شبكة BEP20`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '📤 إنهاء رفع الإثباتات', callback_data: JSON.stringify({ type: 'seller_done_upload', offerId: offer.id }) }]] },
        }
      );
      await safeSendMessage(APPROVE_REJECT_CHANNEL,
        `⏳ تم قبول الصفقة\nرقم العرض: ${offer.number}\nالكمية: ${trade.quantity} USDT`);
      await safeSendMessage(trade.buyerId, '⏳ تم قبول الصفقة، بانتظار إثباتات التحويل');
      await safeDeleteMessage(chatId, query.message.message_id);
      return answer('تم قبول الصفقة');
    }

    // ── seller_reject_trade ────────────────────────────────────────────────
    if (payload.type === callbackTypes.seller_reject_trade) {
      const { offerId } = payload;
      if (offerId === undefined) return answer('❌ بيانات غير مكتملة');
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');
      if (query.from.id !== offer.userId) return answer('❌ غير مصرح');

      const result = await firebaseRemove(`bot_state/offers/${offerId}`);
      if (result) {
        await finishOffer(offer);
        store.deleteOffer(offerId);
        await safeSendMessage(trade.buyerId, `❌ تم رفض الصفقة من البائع\nالعرض رقم: ${offer.number}`);
        await safeSendMessage(trade.sellerId, `❌ لقد رفضت الصفقة. تم إغلاق العرض.`);
        await safeDeleteMessage(chatId, query.message.message_id);
      }
      return answer('تم رفض الصفقة');
    }

    // ── seller_done_upload ─────────────────────────────────────────────────
    if (payload.type === 'seller_done_upload') {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');
      if (query.from.id !== trade.sellerId) return answer('❌ غير مصرح');

      const uploadedProofs = trade.sellerProofs?.length ? trade.sellerProofs : trade.buyerProofs;
      if (!uploadedProofs?.length) return answer('❗ لم يتم رفع أي إثبات');

      await safeDeleteMessage(chatId, query.message.message_id);
      trade.step = 'wait_admin_seller';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });

      await safeSendMessage(APPROVE_REJECT_CHANNEL,
        `🧾 إثباتات البائع\n👤 البائع: +${store.getUser(trade.sellerId)?.phone}\n👤 المشتري: +${store.getUser(trade.buyerId)?.phone}\n📦 الكمية: ${trade.quantity}\nالمبلغ: ${getPrice(offer.price, trade.quantity)}`);
      await Promise.all(uploadedProofs.map(p => getBot().sendPhoto(APPROVE_REJECT_CHANNEL, p)));
      await safeSendMessage(APPROVE_REJECT_CHANNEL, 'اختر الإجراء:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '✔️ الإثباتات صحيحة', callback_data: JSON.stringify({ type: 'admin_confirm_seller', offerId }) },
            { text: '❌ رفض الإثباتات', callback_data: JSON.stringify({ type: 'admin_reject_seller', offerId }) },
          ]],
        },
      });
      await safeSendMessage(trade.sellerId, '⏳ تم إرسال الإثباتات للمراجعة');
      return answer('تم الإرسال');
    }

    // ── admin_confirm_seller ───────────────────────────────────────────────
    if (payload.type === 'admin_confirm_seller') {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!trade) return answer('❌ الصفقة غير موجودة');

      trade.step = 'seller_payment_info';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
      await safeDeleteMessage(chatId, query.message.message_id);
      // await safeSendMessage(trade.sellerId,
      //   `رقم العرض: #${offer.number}\n🏦 الرجاء إدخال معلومات الاستلام\n📦 قمت بتحويل : ${trade.quantity} usdt\nستستلم : ${getPrice(offer.price, trade.quantity)}`);
      await sendAddressPicker(
        trade.sellerId,
        `رقم العرض: #${offer.number}\n🏦 الرجاء إدخال معلومات الاستلام\n📦 قمت بتحويل: ${trade.quantity} USDT\nستستلم: ${getPrice(offer.price, trade.quantity)}`,
        'seller',
        offerId
      );
      return answer('تم التأكيد');
    }

    // ── admin_reject_seller ────────────────────────────────────────────────
    if (payload.type === 'admin_reject_seller') {
      const { offerId } = payload;
      const trade = trades[offerId];
      if (!trade) return answer('❌ الصفقة غير موجودة');
      trade.step = 'seller_upload';
      trade.sellerProofs = [];
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step, sellerProofs: [] });
      await safeSendMessage(trade.sellerId, '❌ تم رفض إثباتات التحويل، يرجى الإرسال مرة أخرى');
      return answer('تم الرفض');
    }

    // ── confirm_seller_payment_info ────────────────────────────────────────
    if (payload.type === callbackTypes.confirm_seller_payment_info) {
      const { offerId } = payload;
      if (offerId === undefined) return answer('❌ بيانات غير مكتملة');
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');
      if (query.from.id !== trade.sellerId) return answer('❌ غير مصرح');

      trade.step = 'wait_admin_confirm_payment_info';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
      const baseInfo =  `📦 الكمية: ${trade.quantity}\nالمبلغ: ${getPrice(offer.price, trade.quantity)}`
     if(trade.paymentInfoFileId) {
      await safeSendPhoto(APPROVE_REJECT_CHANNEL, trade.paymentInfoFileId, {
        caption: baseInfo,
        parse_mode: 'HTML',
      });
     }
    else{
      await safeSendMessage(APPROVE_REJECT_CHANNEL,
       `${baseInfo}\n<code>${trade.paymentInfoText}</code>`,
        { parse_mode: 'HTML' });
      }
      await safeSendMessage(APPROVE_REJECT_CHANNEL, 'اختر الإجراء:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ الموافقة', callback_data: JSON.stringify({ type: 'admin_confirm_seller_payment_info', offerId }) },
            { text: '❌ رفض', callback_data: JSON.stringify({ type: 'admin_reject_seller_payment_info', offerId }) },
          ]],
        },
      });
      await safeDeleteMessage(chatId, query.message.message_id);
      return answer('تم الإرسال للمشرف');
    }

    // if (payload.type === 'admin_confirm_seller_payment_info') {
    //   const { offerId } = payload;
    //   const offer = offers[offerId];
    //   const trade = trades[offerId];
    //   if (!offer || !trade) return answer('❌ الصفقة غير موجودة');

    //   trade.step = 'buyer_upload';
    //   await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
    //   await safeDeleteMessage(chatId, query.message.message_id);
    //   if(trade.paymentInfoFileId) {
    //     await safeSendPhoto(trade.buyerId, trade.paymentInfoFileId);
    //   }
    //   await safeSendMessage(trade.buyerId,
    //     `📋 رقم العرض: #${offer.number}\nرقم المعاملة: ${trade.tradeId}\n📦 الكمية: ${trade.quantity}\n💰 المبلغ: ${getPrice(offer.price, trade.quantity)}\n\n🏦 معلومات الدفع:\n<code>${trade.paymentInfoText}</code>\n\n📥 الرجاء إرسال إثباتات التحويل`,
    //     {
    //       parse_mode: 'HTML',
    //       reply_markup: { inline_keyboard: [[{ text: '✅ إنهاء رفع الإثباتات', callback_data: JSON.stringify({ type: 'buyer_done_upload', offerId: offer.id }) }]] },
    //     }
    //   );
    //   return answer('تم الموافقة');
    // }
    if (payload.type === 'admin_confirm_seller_payment_info') {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');

      trade.step = 'buyer_upload';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
      await safeDeleteMessage(chatId, query.message.message_id);

      const baseInfo = `📋 رقم العرض: #${offer.number}\nرقم المعاملة: ${trade.tradeId}\n📦 الكمية: ${trade.quantity}\n💰 المبلغ: ${getPrice(offer.price, trade.quantity)}\n\n📥 الرجاء إرسال إثباتات التحويل`;
      const doneButton = { reply_markup: { inline_keyboard: [[{ text: '✅ إنهاء رفع الإثباتات', callback_data: JSON.stringify({ type: 'buyer_done_upload', offerId: offer.id }) }]] } };

      if (trade.paymentInfoFileId) {
        // البائع أرسل صورة → نرسل الصورة مع caption
        await safeSendPhoto(trade.buyerId, trade.paymentInfoFileId, {
          caption: baseInfo,
          parse_mode: 'HTML',
          ...doneButton,
        });
      } else {
        // البائع أرسل نص → نرسل رسالة نصية
        await safeSendMessage(trade.buyerId,
          `${baseInfo}\n\n🏦 معلومات الدفع:\n<code>${trade.paymentInfoText}</code>`,
          { parse_mode: 'HTML', ...doneButton }
        );
      }

      return answer('تم الموافقة');
    }
    if (payload.type === 'admin_reject_seller_payment_info') {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');
      trade.step = 'seller_payment_info';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
      await safeSendMessage(trade.sellerId, '❌ معلومات الاستلام غير صحيحة، الرجاء إعادة الإرسال');
      await safeEditMessageText(`❌ تم طلب تعديل معلومات البائع`, { chat_id: chatId, message_id: query.message.message_id }).catch(() => { });
      return answer('تم الإشعار');
    }

    // ── buyer_done_upload ──────────────────────────────────────────────────
    if (payload.type === 'buyer_done_upload') {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!trade) return answer('❌ الصفقة غير موجودة');
      if (query.from.id !== trade.buyerId) return answer('❌ غير مصرح');

      const uploadedProofs = trade.buyerProofs?.length ? trade.buyerProofs : trade.sellerProofs;
      if (!uploadedProofs?.length) return answer('❗ لم ترسل أي إثبات');

      await safeDeleteMessage(chatId, query.message.message_id);
      trade.step = 'wait_admin_buyer';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });

      await safeSendMessage(APPROVE_REJECT_CHANNEL,
        `🧾 إثباتات المشتري\n📦 الكمية: ${trade.quantity}\nالمبلغ: ${getPrice(offer.price, trade.quantity)}`);
      await Promise.all(uploadedProofs.map(p => getBot().sendPhoto(APPROVE_REJECT_CHANNEL, p)));
      await Promise.all(uploadedProofs.map(p => getBot().sendPhoto(trade.sellerId, p, { caption: `🧾 إثباتات المشتري \n رقم العرض: ${offer.number}`, parse_mode: 'HTML' })));
      await safeSendMessage(trade.sellerId,
        `العرض: ${offer.number}\n📦 الكمية المُرسلة: ${trade.quantity} USDT\nالمبلغ الذي ستستلمه: ${getPrice(offer.price, trade.quantity)}\n\nاذا استلمت المبلغ اضغط تم الاستلام \n إذا لم تستلم تواصل مع العم : @Omrano2002`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ تم الاستلام', callback_data: JSON.stringify({ type: 'seller_confirm_buyer', offerId }) }]] } }
      );
    }

    // ── seller_confirm_buyer ───────────────────────────────────────────────
    if (payload.type === 'seller_confirm_buyer') {
      const { offerId } = payload;
      if (offerId === undefined) return answer('❌ بيانات غير مكتملة');
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');

      trade.step = 'buyer_payment_info';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
      // await safeSendMessage(trade.buyerId,
      //   `رقم العرض: #${offer.number}\n🏦 الرجاء إدخال عنوان محفظتك على شبكة BEP20\n📦 الكمية: ${+trade.quantity - 0.25}\nالمبلغ: ${getPrice(offer.price, trade.quantity)}`);

      await sendAddressPicker(
        trade.buyerId,
        `رقم العرض: #${offer.number}\n💎 الرجاء إدخال عنوان محفظتك على شبكة BEP20\n📦 الكمية: ${+trade.quantity - 0.25} USDT\nالمبلغ: ${getPrice(offer.price, trade.quantity)}`,
        'buyer',
        offerId
      );
      await safeDeleteMessage(chatId, query.message.message_id);
    }

    // ── confirm_buyer_payment_info ─────────────────────────────────────────
    if (payload.type === callbackTypes.confirm_buyer_payment_info) {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!offer || !trade) return answer('❌ الصفقة غير موجودة');

      trade.step = 'admin_upload';
      await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });
      const baseInfo = `📋 رقم العرض: #${offer.number}\nرقم المعاملة: ${trade.tradeId}\n📦 الكمية: ${trade.quantity}\n💰 المبلغ: ${getPrice(offer.price, trade.quantity)}\n\n📥 الرجاء إرسال إثباتات التحويل`;
      if (trade.buyerPaymentInfoFileId) {
        await safeSendPhoto(APPROVE_REJECT_CHANNEL, trade.buyerPaymentInfoFileId, {
          caption: baseInfo,
          parse_mode: 'HTML',
        });
      }
      else {

        await safeSendMessage(APPROVE_REJECT_CHANNEL,
          `${baseInfo}\n\n🏦 معلومات الدفع:\n<code>${trade.buyerPaymentInfo}</code>`,
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '✅ إنهاء رفع الإثباتات', callback_data: JSON.stringify({ type: 'finalize_trade', offerId: offer.id }) }]] },
          }
        );
      }
      await safeDeleteMessage(chatId, query.message.message_id);
    }

    if (payload.type === 'send_welcome_message') {
      return sendWelcomeMessage(chatId, query.message,true);
    }
    // ── finalize_trade ─────────────────────────────────────────────────────
    if (payload.type === 'finalize_trade') {
      const { offerId } = payload;
      const offer = offers[offerId];
      const trade = trades[offerId];
      if (!trade) return answer('❌ الصفقة غير موجودة');
      if (!trade.adminProofs?.length) return answer('❌ لم يتم رفع إثبات الأدمن');
      await finalizeTrade(offer, chatId, query.message.message_id);
    }

    // ── cancel_trade ───────────────────────────────────────────────────────
    if (payload.type === 'cancel_trade') {
      await cancelTrade(payload.offerId);
    }

    // ── delete_offer ───────────────────────────────────────────────────────
    if (payload.type === 'delete_offer') {
      const userId = query.from.id;
      const offer = offers[payload.offerId];
      const user = store.getUser(userId);
      if (!offer) return;

      store.deleteOffer(payload.offerId);
      await firebaseRemove(`bot_state/offers/${payload.offerId}`);
      await safeEditMessageText(formatOffer(user, offer, 'تم إلغاء العرض ❌', true, true), {
        chat_id: CHECK_CHANNEL, message_id: offer.checkMessageId, parse_mode: 'HTML',
      });
      if (offer.publicMessageId) {
        await safeEditMessageText(formatOffer(user, offer, '', true), {
          chat_id: OFFERS_CHANNEL, message_id: offer.publicMessageId, parse_mode: 'HTML',
        });
      }
      return safeEditMessageText('🗑 تم حذف العرض بنجاح', { chat_id: chatId, message_id: query.message.message_id });
    }

    // ── manage_offers ──────────────────────────────────────────────────────
    if (payload.type === 'manage_offers') {
      const currentOffers = Object.values(offers).filter(o => o.status !== 'done' && o.status !== 'rejected');
      if (!currentOffers.length) return safeSendMessage(chatId, 'لا توجد عروض حالية');
      for (const o of currentOffers) {
        const user = store.getUser(o.userId);
        await safeSendMessage(chatId, formatPreview(o, `📩 العرض رقم: ${o.number}\nالحالة: ${offerStatus[o.status] || o.status}`), {
          reply_markup: {
            inline_keyboard: [[
              { text: '✏️ تعديل', callback_data: JSON.stringify({ type: callbackTypes.edit_offer, offerId: o.id }) },
              { text: '🗑 حذف', callback_data: JSON.stringify({ type: callbackTypes.delete_offer, offerId: o.id }) },
            ]],
          },
        });
      }
    }

    // ── profile ────────────────────────────────────────────────────────────
    if (payload.type === 'profile') {
      const user = store.getUser(query.from.id);
      if (!user) return;
      await safeEditMessageText(
        `👤 ملفك الشخصي\n\n🏷 الفئة: ${getCategory(user.tradesCount)}\n📊 المعاملات: ${user.tradesCount || 0}\n⭐️ التقييم: ${getAvgRating(user)} / 5\n💬 المقيّمين: ${user.ratings?.length || 0}`,
        {
          chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'عناويني 👤', callback_data: JSON.stringify({ type: 'addr_list' }) }],
              [{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'send_welcome_message' }) }]
            ]
          },
        }
      );
    }

    // ── info ───────────────────────────────────────────────────────────────
    if (payload.type === 'info') {
      await safeSendMessage(query.from.id, `
💎 عن البوت:
وساطة مالية آمنة لتداول USDT بسرعة وعمولة منخفضة
⏱️ مدة المعاملة: 1 ساعة فقط
🔒 ضمان الوسيط | ⚡️ تنفيذ سريع
📢 قناتنا: https://t.me/+TTiTDqauR01kYzM0
🆘 الدعم: @Omrano2002

تصنيف العملاء:
🥉 برونزي: جميع المستخدمين
🥈 فضي: 5 معاملات
🥇 ذهبي: 15 معاملة
👑 ملكي: 30 معاملة
      `,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'back' }) }]] } }
      );
    }

    // ── back ───────────────────────────────────────────────────────────────
    if (payload.type === 'back') {
      await safeDeleteMessage(chatId, query.message.message_id);
      return answer();
    }

    // ── ways → create_usdt ─────────────────────────────────────────────────
    if (payload.type === callbackTypes.ways && payload.data === 'create_usdt') {
      await safeEditMessageText('اختر نوع العملية', {
        chat_id: chatId, message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'أريد بيع USDT 🔴', callback_data: JSON.stringify({ type: callbackTypes.sellOrBuy, data: 'sell' }) }],
            [{ text: 'أريد شراء USDT 🟢', callback_data: JSON.stringify({ type: callbackTypes.sellOrBuy, data: 'buy' }) }],
          ],
        },
      });
      return answer();
    }
  });
}

module.exports = { register };
