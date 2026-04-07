const store = require('../state/store');
const { firebaseUpdate, firebasePush } = require('../firebaseHelpers');
const { safeSendMessage } = require('../utils/botWrapper');
const { isValidNumber, getOfferIdByUser } = require('../utils/helpers');
const { formatPreview } = require('../utils/helpers');
const { callbackTypes } = require('../config/constants');
const { sendWelcomeMessage } = require('./commandHandlers');
const { handleAddressMessages,sendAddressPicker, applyAddressToTrade } = require('../services/addressService');

// ─── معالجة رفع الإثباتات (صور) ─────────────────────────────────────────────
async function handleProofUpload(msg, senderId, offerId, offer, trade) {
  const fileId = msg.photo[msg.photo.length - 1].file_id;

  // البائع يرفع
  if (trade.step === 'seller_upload' && senderId === trade.sellerId) {
    try {
      trade.sellerProofs.push(fileId);
      await firebasePush(`bot_state/trades/${offerId}/sellerProofs`, fileId);
    } catch (err) {
      console.error('Failed to push seller photo', err);
      return safeSendMessage(trade.sellerId, 'فشل في حفظ الصورة، حاول مرة أخرى');
    }
    return safeSendMessage(trade.sellerId,
      `تم استلام الاثبات (${trade.sellerProofs.length})\nعند الانتهاء، اضغط زر انهاء الرفع`);
  }

  // المشتري يرفع
  if (trade.step === 'buyer_upload' && senderId === trade.buyerId) {
    trade.buyerProofs.push(fileId);
    await firebasePush(`bot_state/trades/${offerId}/buyerProofs`, fileId);
    return safeSendMessage(trade.buyerId,
      `تم استلام الاثبات (${trade.buyerProofs.length})\nعند الانتهاء، اضغط زر انهاء الرفع`);
  }

  // الادمن يرفع (نعتمد على الـ step فقط)
  if (trade.step === 'admin_upload') {
    trade.adminProofs.push(fileId);
    await firebasePush(`bot_state/trades/${offerId}/adminProofs`, fileId);
    return safeSendMessage(senderId, `تم استلام الاثبات (${trade.adminProofs.length})`);
  }

  // معلومات دفع البائع
  if (trade.step === 'seller_payment_info' && senderId === trade.sellerId) {
    trade.paymentInfoFileId = fileId;
    await sellerPaymentInfoProccess(trade, offerId);
    return
  }

  // معلومات دفع المشتري
  if (trade.step === 'buyer_payment_info' && senderId === trade.buyerId) {
    trade.buyerPaymentInfoFileId = fileId;
    await buyerPaymentInfoProccess(trade, offerId);
    return
  }
  // شخص غير مصرح له
  return safeSendMessage(senderId, 'لا يوجد اجراء لرفع صور الآن');
}

// ─── معالجة معلومات الدفع (نص) ───────────────────────────────────────────────
async function handlePaymentInfo(msg, senderId, offerId, offer, trade) {

  // معلومات دفع البائع
  if (trade.step === 'seller_payment_info' && senderId === trade.sellerId) {
    trade.paymentInfoText = msg.text.trim();
    await sellerPaymentInfoProccess(trade, offerId, senderId);
  }

  // معلومات دفع المشتري
  if (trade.step === 'buyer_payment_info' && senderId === trade.buyerId) {
    trade.buyerPaymentInfoText = msg.text.trim();
    await buyerPaymentInfoProccess(trade, offerId, senderId);

  }
}

// ─── الـ handler الرئيسي الموحد ───────────────────────────────────────────────
function register(bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from?.id;
    const globals = store.getGlobals();

    // تجاهل الاوامر
    if (msg.text?.startsWith('/')) return;

    // البوت متوقف
    if (!globals.botEnabled || !globals.botAcceptingTrades) {
      return safeSendMessage(chatId, 'البوت متوقف حاليا');
    }

    const user = store.getUser(chatId);
    if (!user) return;

    if (await handleAddressMessages(msg, user, chatId)) return;
    // الاولوية 1: رفع صور توثيق الهوية
    if (msg.photo?.length > 0 && user.verify?.step === 'waiting_photos') {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      user.verify.photos.push(fileId);
      await firebasePush(`bot_state/users/${chatId}/verify/photos`, fileId);
      return safeSendMessage(chatId,
        `تم استلام الاثبات (${user.verify.photos.length})\naضغط زر انهاء الرفع`);
    }

    // الاولوية 2: رفع اثباتات الصفقة او ادخال معلومات الدفع
    const offers = store.getOffers();
    const trades = store.getTrades();
    const offerId = getOfferIdByUser(senderId, offers, trades);

    if (offerId) {
      const offer = offers[offerId];
      const trade = trades[offerId];

      if (msg.photo?.length > 0) {
        return handleProofUpload(msg, senderId, offerId, offer, trade);
      }
      if (msg.text) {
        return handlePaymentInfo(msg, senderId, offerId, offer, trade);
      }
      // return; // نوقف هنا، لا نكمل للـ state flow
    }

    // الاولوية 3: state flow العادي

    const state = user.current;
    if (!state) return;

    // مشاركة رقم الهاتف
    if (state.step === 'askPhone' && msg.contact) {
      user.phone = msg.contact.phone_number;
      user.first_name = msg.contact.first_name;
      user.last_name = msg.contact.last_name;
      user.current = {};
      await firebaseUpdate(`bot_state/users/${chatId}`, { ...user });
      return sendWelcomeMessage(chatId, msg);
    }

    // ادخال السعر
    if (state.step === 'askPrice') {
      const newPrice = msg.text;
      if (!isValidNumber(newPrice))
        return safeSendMessage(chatId, 'الرجاء ادخال رقم صحيح للسعر');
      if (state.transform_way === 'shamDolar' && (Number(newPrice) < 1 || Number(newPrice) > 1.2))
        return safeSendMessage(chatId, 'السعر يجب ان يكون بين 1 و 1.2');
      if (state.transform_way !== 'shamDolar' && (Number(newPrice) < 100 || Number(newPrice) > 135))
        return safeSendMessage(chatId, 'السعر يجب ان يكون بين 100 و 135');

      state.price = newPrice;
      state.step = 'await_trade';
      await firebaseUpdate(`bot_state/users/${chatId}/current`, { step: state.step });
      return safeSendMessage(chatId, formatPreview(state), {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ارسال العرض للمشرف', callback_data: JSON.stringify({ type: callbackTypes.confirm_send }) }],
            [{ text: 'الغاء العرض', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer }) }],
          ],
        },
      });
    }

    // الحد الادنى للكمية
    if (state.step === 'askMinQuantity') {
      if (!isValidNumber(msg.text)) return safeSendMessage(chatId, 'الرجاء ادخال رقم صحيح');
      if (Number(msg.text) < 20) return safeSendMessage(chatId, 'أقل كمية يجب أن تكون 20');
      state.minQuantity = msg.text;
      state.step = 'askMaxQuantity';
      await firebaseUpdate(`bot_state/users/${chatId}/current`, { step: state.step });
      return safeSendMessage(chatId, `تم حفظ الحد الادنى: ${state.minQuantity}\nادخل الحد الاعلى للكمية`);
    }

    // الحد الاعلى للكمية
    if (state.step === 'askMaxQuantity') {
      if (!isValidNumber(msg.text)) return safeSendMessage(chatId, 'الرجاء ادخال رقم صحيح');
      if (Number(msg.text) < Number(state.minQuantity)) return safeSendMessage(chatId, 'الحد الاعلى يجب أن يكون أكبر من الحد الادنى');
      state.maxQuantity = msg.text;
      state.step = 'askPrice';
      await firebaseUpdate(`bot_state/users/${chatId}/current`, { step: state.step });
      return safeSendMessage(chatId, `تم حفظ الحد الاعلى: ${state.maxQuantity}\nاختر السعر`);
    }

    // تعديل السعر
    if (state.step === 'editPrice') {
      if (!isValidNumber(msg.text)) return safeSendMessage(chatId, 'الرجاء ادخال رقم صحيح');
      user.current.editDraft = user.current.editDraft || {};
      user.current.editDraft.price = msg.text;
      user.current.step = 'editing_offer';
      return safeSendMessage(chatId, `تم تحديث السعر الى ${msg.text}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ارسال التعديل للمشرف', callback_data: JSON.stringify({ type: callbackTypes.submit_edit, offerId: user.current.editingOfferId }) }],
            [{ text: 'رجوع', callback_data: JSON.stringify({ type: 'manage_offers' }) }],
          ],
        },
      });
    }

    // تعديل الكمية
    if (state.step === 'editQuantity') {
      const parts = msg.text?.trim().split(/\s+/);
      if (!parts || parts.length < 2 || !isValidNumber(parts[0]) || !isValidNumber(parts[1]))
        return safeSendMessage(chatId, 'ارسل الحد الادنى والاقصى مفصولين بمسافة (مثال: 1 10)');

      user.current.editDraft = user.current.editDraft || {};
      user.current.editDraft.minQuantity = parts[0];
      user.current.editDraft.maxQuantity = parts[1];
      user.current.step = 'editing_offer';
      return safeSendMessage(chatId, `تم تحديث الكمية الى ${parts[0]} - ${parts[1]}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ارسال التعديل للمشرف', callback_data: JSON.stringify({ type: callbackTypes.submit_edit, offerId: user.current.editingOfferId }) }],
            [{ text: 'رجوع', callback_data: JSON.stringify({ type: 'manage_offers' }) }],
          ],
        },
      });
    }

    // ادخال الكمية عند الشراء/البيع
    if (state.step === 'ask_quantity') {
      const qty = Number(msg.text);
      const offer = offers[state.offerId];

      if (isNaN(qty)) return safeSendMessage(chatId, 'الرجاء ادخال رقم');
      if (!offer) return safeSendMessage(chatId, 'العرض غير متاح');
      if (qty < Number(offer.minQuantity) || qty > Number(offer.maxQuantity))
        return safeSendMessage(chatId, `الكمية خارج الحدود (${offer.minQuantity} - ${offer.maxQuantity})`);

      state.quantity = qty;
      state.step = 'confirm_quantity';
      return safeSendMessage(chatId,
        `تاكيد نهائي\n\nالكمية: ${qty}\nلا يمكن التراجع بعد التاكيد`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: 'تاكيد الكمية ✅', callback_data: JSON.stringify({ type: 'confirm_quantity' }) },
              { text: ' الغاء ❌', callback_data: JSON.stringify({ type: 'cancel_quantity' }) },
            ]],
          },
        }
      );
    }
  });
}
async function sellerPaymentInfoProccess(trade, offerId) {
   await applyAddressToTrade(
    trade, offerId,
    trade.paymentInfoText   ?? null,
    trade.paymentInfoFileId ?? null,
    'seller',
    trade.sellerId,
    null  // no picker message to delete (user typed directly)
  );
  // trade.step = 'seller_confirm_payment_info';
  // await firebaseUpdate(`bot_state/trades/${offerId}`, { ...trade });
  // return safeSendMessage(trade.sellerId,
  //   'تم حفظ معلومات الدفع، الرجاء تاكيد الارسال للمشرف',
  //   {
  //     reply_markup: {
  //       inline_keyboard: [[
  //         { text: 'تاكيد', callback_data: JSON.stringify({ type: callbackTypes.confirm_seller_payment_info, offerId: offerId }) },
  //         { text: 'الغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer, offerId: offerId }) },
  //       ]],
  //     },
  //   }
  // );

}

async function buyerPaymentInfoProccess(trade, offerId) {
  // trade.step = 'buyer_confirm_payment_info';
  // await firebaseUpdate(`bot_state/trades/${offerId}`, { ...trade });
  // return safeSendMessage(trade.buyerId,
  //   'تم حفظ معلومات الدفع، الرجاء تاكيد الارسال للمشرف',
  //   {
  //     reply_markup: {
  //       inline_keyboard: [[
  //         { text: 'تاكيد', callback_data: JSON.stringify({ type: callbackTypes.confirm_buyer_payment_info, offerId: offerId }) },
  //         { text: 'الغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer, offerId: offerId }) },
  //       ]],
  //     },
  //   }
  // );
   await applyAddressToTrade(
    trade, offerId,
    trade.buyerPaymentInfoText   ?? null,
    trade.buyerPaymentInfoFileId ?? null,
    'buyer',
    trade.buyerId,
    null
  );
}
module.exports = { register };



// // ================== MESSAGE HANDLERS ==================

// const store = require('../state/store');
// const { firebaseUpdate, firebasePush } = require('../firebaseHelpers');
// const { safeSendMessage, safeDeleteMessage } = require('../utils/botWrapper');
// const { isValidNumber, getPrice, getOfferIdByUser } = require('../utils/helpers');
// const { formatPreview } = require('../utils/helpers');
// const { callbackTypes, transform_way } = require('../config/constants');
// const { sendWelcomeMessage } = require('./commandHandlers');
// const { process: env } = require('../env');

// const APPROVE_REJECT_CHANNEL = env.env.APPROVE_REJECT_CHANNEL;

// function register(bot) {

//   bot.on('message', async (msg) => {
//     const senderId = msg.from?.id;

//     const offers = store.getOffers();
//     const trades = store.getTrades();
//     const offerId = getOfferIdByUser(senderId, offers, trades);
//     console.log(offerId, trades)
//     if (!offerId) return;

//     const offer = offers[offerId];
//     const trade = trades[offerId];
//     if (!offer || !trade) return;


//     // صورة من المشتري
//     if (msg.photo && trade.step === 'buyer_upload') {
//       const fileId = msg.photo[msg.photo.length - 1].file_id;
//       trade.buyerProofs.push(fileId);
//       await firebasePush(`bot_state/trades/${offerId}/buyerProofs`, fileId);
//       return safeSendMessage(trade.buyerId,
//         `📸 تم استلام الإثبات (${trade.buyerProofs.length})\nعند الانتهاء، اضغط زر *إنهاء الرفع* 👆`);
//     }

//     // صورة من البائع
//     if (msg.photo && trade.step === 'seller_upload') {
//       const fileId = msg.photo[msg.photo.length - 1].file_id;
//       try {
//         trade.sellerProofs.push(fileId);
//         await firebasePush(`bot_state/trades/${offerId}/sellerProofs`, fileId);
//       } catch (err) {
//         console.error('Failed to push seller photo', err);
//         return safeSendMessage(trade.sellerId, '❌ فشل في حفظ الصورة، حاول مرة أخرى');
//       }
//       return safeSendMessage(trade.sellerId,
//         `📸 تم استلام الإثبات (${trade.sellerProofs.length})\nعند الانتهاء، اضغط زر *إنهاء الرفع* 👆`);
//     }

//     // صورة من الأدمن
//     if (msg.photo && trade.step === 'admin_upload') {
//       const fileId = msg.photo[msg.photo.length - 1].file_id;
//       trade.adminProofs.push(fileId);
//       await firebasePush(`bot_state/trades/${offerId}/adminProofs`, fileId);
//       return safeSendMessage(senderId,
//         `📸 تم استلام الإثبات (${trade.adminProofs.length}) وتمت الصفقة`);
//     }

//     // معلومات دفع البائع
//     if (trade.step === 'seller_payment_info' && msg.text) {
//       trade.paymentInfo = msg.text.trim();
//       trade.step = 'seller_confirm_payment_info';
//       await firebaseUpdate(`bot_state/trades/${offerId}`, { step: trade.step });

//       return safeSendMessage(senderId,
//         '✅ تم حفظ معلومات الدفع، الرجاء تأكيد الإرسال للمشرف',
//         {
//           reply_markup: {
//             inline_keyboard: [[
//               { text: '✅ تأكيد', callback_data: JSON.stringify({ type: callbackTypes.confirm_seller_payment_info, offerId: offer.id }) },
//               { text: '❌ إلغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer, offerId: offer.id }) },
//             ]],
//           },
//         }
//       );
//     }

//     // معلومات دفع المشتري
//     if (trade.step === 'buyer_payment_info' && msg.text) {
//       trade.buyerPaymentInfo = msg.text.trim();
//       trade.step = 'buyer_confirm_payment_info';
//       await firebaseUpdate(`bot_state/trades/${offerId}`, { ...trade });

//       return safeSendMessage(trade.buyerId,   // ✅ Bug مُصلح: chatId كان مفقوداً
//         '✅ تم حفظ معلومات الدفع، الرجاء تأكيد الإرسال للمشرف',
//         {
//           reply_markup: {
//             inline_keyboard: [[
//               { text: '✅ تأكيد', callback_data: JSON.stringify({ type: callbackTypes.confirm_buyer_payment_info, offerId: offer.id }) },
//               { text: '❌ إلغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer, offerId: offer.id }) },
//             ]],
//           },
//         }
//       );
//     }
//   });

//   // ─── رسائل المستخدم العادي (الحالة/state flow) ────────────────────────────
//   bot.on('message', async (msg) => {
//     const chatId = msg.chat.id;
//     const globals = store.getGlobals();

//     if (msg.text?.startsWith('/')) return;

//     if (!globals.botEnabled || !globals.botAcceptingTrades) {
//       return safeSendMessage(chatId, '🕑 البوت متوقف حاليا');
//     }

//     const user = store.getUser(chatId);
//     if (!user) return;

//     // رفع صور التوثيق
//     if (msg.photo?.length > 0 && user.verify?.step === 'waiting_photos') {
//       const fileId = msg.photo[msg.photo.length - 1].file_id;
//       user.verify.photos.push(fileId);
//       await firebasePush(`bot_state/users/${chatId}/verify/photos`, fileId);
//       return safeSendMessage(chatId,
//         `📸 تم استلام الإثبات (${user.verify.photos.length})\nاضغط زر *إنهاء الرفع*`);
//     }

//     const state = user.current;
//     if (!state) return;

//     // مشاركة رقم الهاتف
//     if (state.step === 'askPhone' && msg.contact) {
//       user.phone = msg.contact.phone_number;
//       user.first_name = msg.contact.first_name;
//       user.last_name = msg.contact.last_name;
//       user.current = {};
//       await firebaseUpdate(`bot_state/users/${chatId}`, { ...user });
//       return sendWelcomeMessage(chatId, msg, bot);
//     }

//     // إدخال السعر
//     if (state.step === 'askPrice') {
//       const newPrice = msg.text;
//       if (!isValidNumber(newPrice)) return safeSendMessage(chatId, '❌ الرجاء إدخال رقم صحيح للسعر');
//       if (state.transform_way === 'shamDolar' && (Number(newPrice) < 1 || Number(newPrice) > 1.2))
//         return safeSendMessage(chatId, '❌ السعر يجب أن يكون بين 1 و 1.2');
//       if (state.transform_way !== 'shamDolar' && (Number(newPrice) < 100 || Number(newPrice) > 135))
//         return safeSendMessage(chatId, '❌ السعر يجب أن يكون بين 100 و 135');

//       state.price = newPrice;
//       state.step = 'await_trade';
//       await firebaseUpdate(`bot_state/users/${chatId}/current`, { step: state.step });
//       return safeSendMessage(chatId, formatPreview(state), {
//         reply_markup: {
//           inline_keyboard: [
//             [{ text: '✅ إرسال العرض للمشرف', callback_data: JSON.stringify({ type: callbackTypes.confirm_send }) }],
//             [{ text: '❌ إلغاء العرض', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer }) }],
//           ],
//         },
//       });
//     }

//     // الحد الأدنى للكمية
//     if (state.step === 'askMinQuantity') {
//       if (!isValidNumber(msg.text)) return safeSendMessage(chatId, '❌ الرجاء إدخال رقم صحيح');
//       state.minQuantity = msg.text;
//       state.step = 'askMaxQuantity';
//       await firebaseUpdate(`bot_state/users/${chatId}/current`, { step: state.step });
//       return safeSendMessage(chatId, `تم حفظ الحد الأدنى: ${state.minQuantity}\nأدخل الحد الأعلى للكمية`);
//     }

//     // الحد الأعلى للكمية
//     if (state.step === 'askMaxQuantity') {
//       if (!isValidNumber(msg.text)) return safeSendMessage(chatId, '❌ الرجاء إدخال رقم صحيح');
//       state.maxQuantity = msg.text;
//       state.step = 'askPrice';
//       await firebaseUpdate(`bot_state/users/${chatId}/current`, { step: state.step });
//       return safeSendMessage(chatId, `تم حفظ الحد الأعلى: ${state.maxQuantity}\nاختر السعر`);
//     }

//     // تعديل السعر
//     if (state.step === 'editPrice') {
//       if (!isValidNumber(msg.text)) return safeSendMessage(chatId, '❌ الرجاء إدخال رقم صحيح');
//       user.current.editDraft = user.current.editDraft || {};
//       user.current.editDraft.price = msg.text;
//       user.current.step = 'editing_offer';
//       return safeSendMessage(chatId, `✅ تم تحديث السعر إلى ${msg.text}`, {
//         reply_markup: {
//           inline_keyboard: [
//             [{ text: '✅ إرسال التعديل للمشرف', callback_data: JSON.stringify({ type: callbackTypes.submit_edit, offerId: user.current.editingOfferId }) }],
//             [{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'manage_offers' }) }],
//           ],
//         },
//       });
//     }

//     // تعديل الكمية
//     if (state.step === 'editQuantity') {
//       const parts = msg.text.trim().split(/\s+/);
//       if (parts.length < 2 || !isValidNumber(parts[0]) || !isValidNumber(parts[1]))
//         return safeSendMessage(chatId, '❌ أرسل الحد الأدنى والأقصى مفصولين بمسافة (مثال: 1 10)');

//       user.current.editDraft = user.current.editDraft || {};
//       user.current.editDraft.minQuantity = parts[0];
//       user.current.editDraft.maxQuantity = parts[1];
//       user.current.step = 'editing_offer';
//       return safeSendMessage(chatId, `✅ تم تحديث الكمية إلى ${parts[0]} - ${parts[1]}`, {
//         reply_markup: {
//           inline_keyboard: [
//             [{ text: '✅ إرسال التعديل للمشرف', callback_data: JSON.stringify({ type: callbackTypes.submit_edit, offerId: user.current.editingOfferId }) }],
//             [{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'manage_offers' }) }],
//           ],
//         },
//       });
//     }

//     // إدخال الكمية عند الشراء
//     if (state.step === 'ask_quantity') {
//       const qty = Number(msg.text);
//       const offers = store.getOffers();
//       const offer = offers[state.offerId];

//       if (isNaN(qty)) return safeSendMessage(chatId, '❌ الرجاء إدخال رقم');
//       if (!offer) return safeSendMessage(chatId, '❌ العرض غير متاح');
//       if (qty < offer.minQuantity || qty > offer.maxQuantity)
//         return safeSendMessage(chatId, '❌ الكمية خارج الحدود المسموحة');

//       state.quantity = qty;
//       state.step = 'confirm_quantity';
//       return safeSendMessage(chatId,
//         `⚠️ تأكيد نهائي\n\nالكمية: ${qty}\n❗ لا يمكن التراجع بعد التأكيد`,
//         {
//           reply_markup: {
//             inline_keyboard: [[
//               { text: '✅ تأكيد الكمية', callback_data: JSON.stringify({ type: 'confirm_quantity' }) },
//               { text: '❌ إلغاء', callback_data: JSON.stringify({ type: 'cancel_quantity' }) },
//             ]],
//           },
//         }
//       );
//     }
//   });
// }

// module.exports = { register };

// ================== MESSAGE HANDLERS ==================

