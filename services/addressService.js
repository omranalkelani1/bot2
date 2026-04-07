// ================== ADDRESS SERVICE ==================
// خدمة إدارة العناوين المحفوظة + الاستخدام داخل الصفقات

const store              = require('../state/store');
const { firebaseUpdate } = require('../firebaseHelpers');
const {
  safeSendMessage,
  safeEditMessageText,
  safeAnswerCallback,
} = require('../utils/botWrapper');
const { callbackTypes }  = require('../config/constants');

const MAX_ADDRESSES = 3;

const ADDRESS_TYPES = {
  usdt:  '💎 محفظة USDT (BEP20)',
  bank:  '🏦 حساب بنكي',
  other: '📋 أخرى',
};

// ─── internal helpers ─────────────────────────────────────────────────────────

function getAddresses(user) {
  if (!user.addresses) user.addresses = [];
  return user.addresses;
}

function buildAddressListKeyboard(addresses) {
  const rows = addresses.map((addr, i) => [{
    text: `${ADDRESS_TYPES[addr.type] ?? addr.type} — ${addr.label}`,
    callback_data: JSON.stringify({ type: 'addr_view', index: i }),
  }]);
  if (addresses.length < MAX_ADDRESSES) {
    rows.push([{ text: '➕ إضافة عنوان', callback_data: JSON.stringify({ type: 'addr_add' }) }]);
  }
  rows.push([{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'profile' }) }]);
  return rows;
}

async function sendAddressList(chatId, user, editTarget = null) {
  const addresses = getAddresses(user);
  const text = addresses.length === 0
    ? '📂 لا توجد عناوين محفوظة بعد\nيمكنك إضافة حتى 3 عناوين.'
    : `📂 عناوينك المحفوظة (${addresses.length}/${MAX_ADDRESSES})`;

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buildAddressListKeyboard(addresses) },
  };
  return editTarget
    ? safeEditMessageText(text, { ...editTarget, ...opts })
    : safeSendMessage(chatId, text, opts);
}

async function sendAddressDetail(chatId, addresses, index, editTarget = null) {
  const addr = addresses[index];
  if (!addr) return;

  const text =
    `${ADDRESS_TYPES[addr.type] ?? addr.type}\n` +
    `🏷 الاسم: <b>${addr.label}</b>\n` +
    `📋 العنوان:\n<code>${addr.value}</code>`;

  const keyboard = [
    [
      { text: '✏️ تعديل الاسم',   callback_data: JSON.stringify({ type: 'addr_edit_label', index }) },
      { text: '📝 تعديل العنوان', callback_data: JSON.stringify({ type: 'addr_edit_value', index }) },
    ],
    [{ text: '🗑 حذف', callback_data: JSON.stringify({ type: 'addr_delete', index }) }],
    [{ text: '⬅️ رجوع', callback_data: JSON.stringify({ type: 'addr_list' }) }],
  ];

  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
  return editTarget
    ? safeEditMessageText(text, { ...editTarget, ...opts })
    : safeSendMessage(chatId, text, opts);
}

// ─── PUBLIC: address picker shown during a trade ──────────────────────────────

/**
 * Called by callbackHandlers when the bot reaches a payment-info step.
 * Shows saved addresses as quick-select buttons, plus a "type manually" option.
 *
 * @param {number}        userId       – who to send to
 * @param {string}        prompt       – header text (e.g. "أدخل عنوان محفظتك")
 * @param {'seller'|'buyer'} context   – determines which address types to surface
 * @param {number|string} offerId      – forwarded into addr_use callback payload
 */
async function sendAddressPicker(userId, prompt, context, offerId) {
  const user      = store.getUser(userId);
  const addresses = getAddresses(user);

  // Buyer needs a USDT wallet; seller needs a bank/other account
  const relevant = addresses.filter(addr =>
    context === 'buyer' ? addr.type === 'usdt' : addr.type !== 'usdt'
  );

  const keyboard = [];

  for (const addr of relevant) {
    const globalIndex = addresses.indexOf(addr);
    keyboard.push([{
      text: `${ADDRESS_TYPES[addr.type] ?? addr.type} — ${addr.label}`,
      callback_data: JSON.stringify({ type: 'addr_use', index: globalIndex, context, offerId }),
    }]);
  }

  if (relevant.length > 0) {
    keyboard.push([{
      text: '✏️ كتابة عنوان جديد يدوياً',
      callback_data: JSON.stringify({ type: 'addr_use_manual', context, offerId }),
    }]);
  }

  const hasButtons = keyboard.length > 0;
  const fullText   = hasButtons
    ? `${prompt}\n\n📂 اختر من عناوينك المحفوظة أو اكتب عنواناً جديداً:`
    : `${prompt}\n\nاكتب العنوان أو معلومات الاستلام:`;

  return safeSendMessage(userId, fullText, {
    parse_mode: 'HTML',
    ...(hasButtons && { reply_markup: { inline_keyboard: keyboard } }),
  });
}

// ─── shared: write chosen address into trade + send confirm prompt ────────────

/**
 * Sets the payment info on the trade object and sends the confirm-send message
 * to the correct party. Used by both the button path (addr_use) and the
 * existing text/photo path in messageHandlers.
 *
 * @param {object}        trade
 * @param {number|string} offerId
 * @param {string|null}   textValue   – address as plain text (null if image)
 * @param {string|null}   fileId      – Telegram file_id (null if text)
 * @param {'seller'|'buyer'} context
 * @param {number}        chatId      – chat where picker message lives (for delete)
 * @param {number|null}   deleteMsgId – picker message to delete after selection
 */
async function applyAddressToTrade(trade, offerId, textValue, fileId, context, chatId, deleteMsgId = null) {
  const { safeDeleteMessage } = require('../utils/botWrapper');

  if (context === 'seller') {
    if (fileId)    trade.paymentInfoFileId = fileId;
    if (textValue) trade.paymentInfoText   = textValue;
    trade.step = 'seller_confirm_payment_info';
    await firebaseUpdate(`bot_state/trades/${offerId}`, { ...trade });
    if (deleteMsgId) await safeDeleteMessage(chatId, deleteMsgId);
    await safeSendMessage(
      trade.sellerId,
      `تم حفظ معلومات الدفع:\n<code>${textValue ?? '(صورة)'}</code>\n\nالرجاء تأكيد الإرسال للمشرف`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ تأكيد', callback_data: JSON.stringify({ type: callbackTypes.confirm_seller_payment_info, offerId }) },
            { text: '❌ إلغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer,               offerId }) },
          ]],
        },
      }
    );
  } else {
    if (fileId)    trade.buyerPaymentInfoFileId = fileId;
    if (textValue) {
      trade.buyerPaymentInfoText = textValue;
      trade.buyerPaymentInfo     = textValue; // legacy field used in callbackHandlers
    }
    trade.step = 'buyer_confirm_payment_info';
    await firebaseUpdate(`bot_state/trades/${offerId}`, { ...trade });
    if (deleteMsgId) await safeDeleteMessage(chatId, deleteMsgId);
    await safeSendMessage(
      trade.buyerId,
      `تم حفظ عنوان المحفظة:\n<code>${textValue ?? '(صورة)'}</code>\n\nالرجاء تأكيد الإرسال للمشرف`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ تأكيد', callback_data: JSON.stringify({ type: callbackTypes.confirm_buyer_payment_info, offerId }) },
            { text: '❌ إلغاء', callback_data: JSON.stringify({ type: callbackTypes.cancel_offer,              offerId }) },
          ]],
        },
      }
    );
  }
}

// ─── callback handler ─────────────────────────────────────────────────────────

async function handleAddressCallbacks(query, rawData) {
  if (!rawData.includes('addr_')) return false;

  let payload;
  try { payload = JSON.parse(rawData); } catch { return false; }
  if (typeof payload.type !== 'string' || !payload.type.startsWith('addr_')) return false;

  const chatId     = query.message.chat.id;
  const userId     = query.from.id;
  const msgId      = query.message.message_id;
  const answer     = (text = '', alert = false) => safeAnswerCallback(query.id, text, alert);
  const user       = store.getUser(userId);
  if (!user) return true;

  const addresses  = getAddresses(user);
  const editTarget = { chat_id: chatId, message_id: msgId };

  // ── addr_list ─────────────────────────────────────────────────────────────
  if (payload.type === 'addr_list') {
    await sendAddressList(chatId, user, editTarget);
    answer(); return true;
  }

  // ── addr_view ─────────────────────────────────────────────────────────────
  if (payload.type === 'addr_view') {
    await sendAddressDetail(chatId, addresses, payload.index, editTarget);
    answer(); return true;
  }

  // ── addr_add ──────────────────────────────────────────────────────────────
  if (payload.type === 'addr_add') {
    if (addresses.length >= MAX_ADDRESSES) {
      answer('❌ وصلت للحد الأقصى (3 عناوين)', true); return true;
    }
    user.current = { step: 'addr_choose_type' };
    await safeEditMessageText('اختر نوع العنوان الجديد:', {
      ...editTarget,
      reply_markup: {
        inline_keyboard: [
          ...Object.entries(ADDRESS_TYPES).map(([k, v]) => [{
            text: v,
            callback_data: JSON.stringify({ type: 'addr_type_chosen', addrType: k }),
          }]),
          [{ text: '❌ إلغاء', callback_data: JSON.stringify({ type: 'addr_list' }) }],
        ],
      },
    });
    answer(); return true;
  }

  // ── addr_type_chosen ──────────────────────────────────────────────────────
  if (payload.type === 'addr_type_chosen') {
    user.current = { step: 'addr_ask_label', addrType: payload.addrType };
    await safeEditMessageText(
      `${ADDRESS_TYPES[payload.addrType]}\nأدخل اسماً مختصراً لهذا العنوان\nمثال: محفظتي الرئيسية`,
      {
        ...editTarget,
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: JSON.stringify({ type: 'addr_list' }) }]] },
      }
    );
    answer(); return true;
  }

  // ── addr_use — user picks a saved address during a trade ──────────────────
  if (payload.type === 'addr_use') {
    const addr = addresses[payload.index];
    if (!addr) { answer('❌ العنوان غير موجود', true); return true; }

    const trades = store.getTrades();
    const trade  = trades[payload.offerId];
    if (!trade) { answer('❌ الصفقة غير موجودة', true); return true; }

    await applyAddressToTrade(trade, payload.offerId, addr.value, null, payload.context, chatId, msgId);
    answer(`✅ تم اختيار: ${addr.label}`);
    return true;
  }

  // ── addr_use_manual — dismiss picker, let user type freely ────────────────
  if (payload.type === 'addr_use_manual') {
    const hint = payload.context === 'buyer'
      ? '✏️ اكتب عنوان محفظتك على شبكة BEP20:'
      : '✏️ اكتب معلومات الاستلام (رقم حساب، اسم، إلخ):';
    await safeEditMessageText(hint, { chat_id: chatId, message_id: msgId });
    answer(); return true;
  }

  // ── addr_delete ───────────────────────────────────────────────────────────
  if (payload.type === 'addr_delete') {
    const addr = addresses[payload.index];
    if (!addr) { answer('❌ العنوان غير موجود', true); return true; }
    await safeEditMessageText(
      `⚠️ هل تريد حذف العنوان:\n<b>${addr.label}</b>؟`,
      {
        ...editTarget,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ نعم، احذف', callback_data: JSON.stringify({ type: 'addr_delete_confirm', index: payload.index }) },
            { text: '❌ إلغاء',     callback_data: JSON.stringify({ type: 'addr_view',          index: payload.index }) },
          ]],
        },
      }
    );
    answer(); return true;
  }

  // ── addr_delete_confirm ───────────────────────────────────────────────────
  if (payload.type === 'addr_delete_confirm') {
    const index = payload.index;
    if (index < 0 || index >= addresses.length) { answer('❌ خطأ', true); return true; }
    addresses.splice(index, 1);
    await firebaseUpdate(`bot_state/users/${userId}`, { addresses });
    await sendAddressList(chatId, user, editTarget);
    answer('✅ تم الحذف'); return true;
  }

  // ── addr_edit_label ───────────────────────────────────────────────────────
  if (payload.type === 'addr_edit_label') {
    user.current = { step: 'addr_edit_label', editIndex: payload.index };
    await safeEditMessageText('أدخل الاسم الجديد للعنوان:', {
      ...editTarget,
      reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: JSON.stringify({ type: 'addr_view', index: payload.index }) }]] },
    });
    answer(); return true;
  }

  // ── addr_edit_value ───────────────────────────────────────────────────────
  if (payload.type === 'addr_edit_value') {
    user.current = { step: 'addr_edit_value', editIndex: payload.index };
    await safeEditMessageText('أدخل العنوان/الرقم الجديد:', {
      ...editTarget,
      reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: JSON.stringify({ type: 'addr_view', index: payload.index }) }]] },
    });
    answer(); return true;
  }

  return false;
}

// ─── message handler ──────────────────────────────────────────────────────────

async function handleAddressMessages(msg, user, chatId) {
  const state = user.current;
  if (!state?.step?.startsWith('addr_')) return false;
  if (!msg.text) return false;

  const text      = msg.text.trim();
  const addresses = getAddresses(user);

  if (state.step === 'addr_ask_label') {
    if (!text || text.length > 30)
      return safeSendMessage(chatId, '❌ الاسم يجب أن يكون بين 1 و 30 حرفاً'), true;
    user.current = { step: 'addr_ask_value', addrType: state.addrType, addrLabel: text };
    await safeSendMessage(chatId, `اسم العنوان: <b>${text}</b>\nأدخل العنوان/الرقم الفعلي:`, { parse_mode: 'HTML' });
    return true;
  }

  if (state.step === 'addr_ask_value') {
    if (!text || text.length > 200)
      return safeSendMessage(chatId, '❌ العنوان طويل جداً أو فارغ'), true;
    if (addresses.length >= MAX_ADDRESSES) {
      user.current = {};
      return safeSendMessage(chatId, `❌ لا يمكن إضافة أكثر من ${MAX_ADDRESSES} عناوين`), true;
    }
    const newAddr = { type: state.addrType, label: state.addrLabel, value: text };
    addresses.push(newAddr);
    user.current = {};
    await firebaseUpdate(`bot_state/users/${chatId}`, { addresses });
    await safeSendMessage(
      chatId,
      `✅ تم حفظ العنوان!\n${ADDRESS_TYPES[newAddr.type]} — <b>${newAddr.label}</b>\n<code>${newAddr.value}</code>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📂 عناويني', callback_data: JSON.stringify({ type: 'addr_list' }) }]] } }
    );
    return true;
  }

  if (state.step === 'addr_edit_label') {
    const index = state.editIndex;
    if (index === undefined || !addresses[index]) {
      user.current = {};
      return safeSendMessage(chatId, '❌ العنوان غير موجود'), true;
    }
    if (!text || text.length > 30)
      return safeSendMessage(chatId, '❌ الاسم يجب أن يكون بين 1 و 30 حرفاً'), true;
    addresses[index].label = text;
    user.current = {};
    await firebaseUpdate(`bot_state/users/${chatId}`, { addresses });
    await safeSendMessage(chatId, `✅ تم تحديث الاسم إلى: <b>${text}</b>`, { parse_mode: 'HTML' });
    return true;
  }

  if (state.step === 'addr_edit_value') {
    const index = state.editIndex;
    if (index === undefined || !addresses[index]) {
      user.current = {};
      return safeSendMessage(chatId, '❌ العنوان غير موجود'), true;
    }
    if (!text || text.length > 200)
      return safeSendMessage(chatId, '❌ العنوان طويل جداً أو فارغ'), true;
    addresses[index].value = text;
    user.current = {};
    await firebaseUpdate(`bot_state/users/${chatId}`, { addresses });
    await safeSendMessage(chatId, `✅ تم تحديث العنوان:\n<code>${text}</code>`, { parse_mode: 'HTML' });
    return true;
  }

  return false;
}

module.exports = {
  getAddresses,
  sendAddressList,
  sendAddressPicker,
  applyAddressToTrade,
  handleAddressCallbacks,
  handleAddressMessages,
  ADDRESS_TYPES,
  MAX_ADDRESSES,
};