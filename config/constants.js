// ================== CONSTANTS ==================

const TradeSteps = {
  CONFIRM_QUANTITY:            'confirm_quantity',
  SELLER_UPLOAD:               'seller_upload',
  SELLER_DONE_UPLOAD:          'seller_done_upload',
  ADMIN_CONFIRM_SELLER:        'admin_confirm_seller',
  SELLER_PAYMENT_INFO:         'seller_payment_info',
  BUYER_UPLOAD:                'buyer_upload',
  BUYER_DONE_UPLOAD:           'buyer_done_upload',
  SELLER_CONFIRM_BUYER:        'seller_confirm_buyer',
  BUYER_PAYMENT_INFO_TO_ADMIN: 'buyer_payment_info_toAdmin',
  ADMIN_UPLOAD:                'admin_upload',
  FINALIZE_TRADE:              'finalize_trade',
};

const TradeStepsAR = {
  [TradeSteps.CONFIRM_QUANTITY]:            'تأكيد الكمية',
  [TradeSteps.SELLER_UPLOAD]:               '📤 البائع يرفع الإثبات',
  [TradeSteps.SELLER_DONE_UPLOAD]:          '✅ البائع أنهى الرفع',
  [TradeSteps.ADMIN_CONFIRM_SELLER]:        '🛂 بانتظار تأكيد الأدمن',
  [TradeSteps.SELLER_PAYMENT_INFO]:         '💳 بيانات دفع البائع',
  [TradeSteps.BUYER_UPLOAD]:                '📤 المشتري يرفع الإثبات',
  [TradeSteps.BUYER_DONE_UPLOAD]:           '✅ المشتري أنهى الرفع',
  [TradeSteps.SELLER_CONFIRM_BUYER]:        '🛂 البائع يؤكد إثبات المشتري',
  [TradeSteps.BUYER_PAYMENT_INFO_TO_ADMIN]: '💳 بيانات المشتري للأدمن',
  [TradeSteps.ADMIN_UPLOAD]:                '📸 الأدمن يرفع الإثبات النهائي',
  [TradeSteps.FINALIZE_TRADE]:              '🎉 تمت الصفقة',
};

const callbackTypes = {
  ways:                        'ways',
  sellOrBuy:                   'sellOrBuy',
  transform_way:               'transform_way',
  approve:                     'approve',
  reject:                      'reject',
  confirm_send:                'confirm_send',
  confirm_seller_payment_info: 'confirm_seller_payment_info',
  confirm_buyer_payment_info:  'confirm_buyer_payment_info',
  seller_accept_trade:         'seller_accept_trade',
  seller_reject_trade:         'seller_reject_trade',
  cancel_trade:                'cancel_trade',
  edit_offer:                  'edit_offer',
  edit_price:                  'edit_price',
  edit_quantity:               'edit_quantity',
  edit_transform_way:          'edit_transform_way',
  submit_edit:                 'submit_edit',
  admin_approve_edit:          'admin_approve_edit',
  admin_reject_edit:           'admin_reject_edit',
  cancel_offer:                'cancel_offer',
  done:                        'done',
  delete_offer:                'delete_offer',
  verify_me:                   'verify_me',
  verify_confirm:              'verify_confirm',
  verify_reject:               'verify_reject',
  verify_approve:              'verify_approve',
};

const transform_way = {
  haram:      'الهرم',
  fuad:       'الفؤاد',
  shamDolar:  '(دولار) شام كاش',
  shamSy:     '(سوري) شام كاش',
  mtn:        'ام تي ان كاش',
  syriatel:   'سيرياتل كاش',
  kadmos:     'القدموس',
};

const offerStatus = {
  pending:  'انتظار موافقة المشرف',
  approved: 'مقبول',
  rejected: 'مرفوض',
};

module.exports = { TradeSteps, TradeStepsAR, callbackTypes, transform_way, offerStatus };
