// ================== STORAGE LOADER ==================

const { db }           = require('../firebase');
const { firebaseUpdate } = require('../firebaseHelpers');
const store            = require('../state/store');
const { asArray }      = require('../utils/helpers');

const defaultData = {
  globals: {
    offerSeq:          0,
    forwardingNum:     0,
    tradeId:           0,
    botEnabled:        true,
    botAcceptingTrades: true,
  },
  users:  {},
  offers: {},
  trades: {},
};

async function loadStorage(retry = 2) {
  try {

    console.log('hii');
    const snapshot = await db.ref('bot_state').once('value');
    
    console.log('welcome');
    const data     = snapshot.val();

    if (!data) {
      console.log('⚠️  No data in Firebase → using defaults');
      return defaultData;
    }

    // تحويل Firebase arrays → JS arrays
    if (data.users) {
      for (const uid in data.users) {
        const user = data.users[uid];
        user.ratings = asArray(user.ratings);
        if (user.verify) user.verify.photos = asArray(user.verify.photos);
        user.addresses = user.addresses ? asArray(user.addresses) : [];
      }
    }
    if (data.trades) {
      for (const offerId in data.trades) {
        const trade = data.trades[offerId];
        trade.adminProofs  = asArray(trade.adminProofs);
        trade.sellerProofs = asArray(trade.sellerProofs);
        trade.buyerProofs  = asArray(trade.buyerProofs);
      }
    }

    return data;
  } catch (err) {
    if (retry > 0) {
      await new Promise(r => setTimeout(r, 1000)); // await صحيحة
      return loadStorage(retry - 1);
    }
    console.error('❌ Firebase load failed:', err.message);
    return defaultData;
  }
}

async function initStorage() {
  
  try {
    console.log('a,');
    const data = await loadStorage();
    store.hydrate({
      globals: data.globals,
      offers:  data.offers,
      trades:  data.trades,
      users:   data.users,
    });
    
    // ضمان القيم الافتراضية
    const g = store.getGlobals();
    if (typeof g.botEnabled          === 'undefined') store.setGlobals({ botEnabled: true });
    if (typeof g.botAcceptingTrades  === 'undefined') store.setGlobals({ botAcceptingTrades: true });

    console.log('✅ Storage loaded from Firebase');
    console.log(`   Users: ${Object.keys(store.getUsers()).length}`);
    console.log(`   Offers: ${Object.keys(store.getOffers()).length}`);
    console.log(`   Trades: ${Object.keys(store.getTrades()).length}`);
  } catch (err) {
    console.error('❌ initStorage failed:', err.message);
  }
}

module.exports = { initStorage };
