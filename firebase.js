const admin = require('firebase-admin');

// ضع الملف الذي حملته في نفس المجلد أو في مكان آمن
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://omran2002bot-default-rtdb.asia-southeast1.firebasedatabase.app/'
});

const db = admin.database();

module.exports = { db };