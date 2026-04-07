const admin = require('firebase-admin');
const {env} = require('./env');

// // ضع الملف الذي حملته في نفس المجلد أو في مكان آمن
// const serviceAccount = require('./omranoo.json');
// console.log('dd',serviceAccount.project_id);

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//    databaseURL: `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app/` 
// });

// const db = admin.database();

// module.exports = { db };


const serviceAccount =  JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)  // من .env

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://omran2002bot-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();
module.exports = { db };