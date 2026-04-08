// ================== CENTRAL STATE STORE ==================
// مصدر الحقيقة الوحيد لجميع البيانات في الذاكرة

let globals = {
  offerSeq: 0,
  forwardingNum: 0,
  tradeId: 0,
  botEnabled: true,
  botAcceptingTrades: true,
};

let offers     = {};
let trades     = {};
let userStates = {};

module.exports = {
  getGlobals:    ()        => globals,
  setGlobals:    (data)    => { globals = { ...globals, ...data }; },

  getOffers:     ()        => offers,
  setOffer:      (id, val) => { offers[id] = val; },
  setOffers:     (newOffers) => { offers = newOffers; },
  deleteOffer:   (id)      => { delete offers[id]; },

  getTrades:     ()        => trades,
  setTrade:      (id, val) => { trades[id] = val; },
  setTrades:     (newTrades) => { trades = newTrades; },
  deleteTrade:   (id)      => { delete trades[id]; },

  getUsers:      ()        => userStates,
  getUser:       (id)      => userStates[id],
  setUser:       (id, val) => { userStates[id] = val; },

  /** تحميل كل البيانات دفعة واحدة من Firebase عند الإقلاع */
  hydrate({ globals: g, offers: o, trades: t, users: u }) {
    if (g) globals     = { ...globals, ...g };
    if (o) offers      = o;
    if (t) trades      = t;
    if (u) userStates  = u;
  },
};
