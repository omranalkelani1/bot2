// firebaseHelpers.js
const { db } = require('./firebase'); // افترض أنك عرّفت db هنا

/**
 * كتابة قيمة كاملة في مسار معين (set)
 * @param {string} path - المسار في Firebase (مثال: "bot_state/users/123456")
 * @param {any} value - القيمة التي سيتم حفظها
 */
async function firebaseSet(path, value) {
  try {
    await db.ref(path).set(value);
    console.log(`[SET] Success: ${path}`);
    return true;
  } catch (err) {
    console.error(`[SET] Failed at ${path}:`, err.message);
    return false;
  }
}

/**
 * تحديث جزئي (update) - يُفضّل استخدامه لتغيير حقل أو أكثر دون مسح الباقي
 * @param {string} path 
 * @param {object} updates - { key1: value1, key2: value2, ... }
 */
async function firebaseUpdate(path, updates) {
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    console.warn(`[UPDATE] No updates provided for ${path}`);
    return false;
  }

  try {
    await db.ref(path).update(updates);
    console.log(`[UPDATE] Success: ${path} → ${Object.keys(updates).join(', ')}`);
    return true;
  } catch (err) {
    console.error(`[UPDATE] Failed at ${path}:`, err.message);
    return false;
  }
}

/**
 * إضافة عنصر جديد بمفتاح تلقائي (push) - مثالي للـ offers أو ratings
 * @param {string} path 
 * @param {any} value 
 * @returns {string | null} المفتاح الجديد الذي تم إنشاؤه (push key)
 */
async function firebasePush(path, value,withoutGenerateKey = false) {
  try {
    const newRef = withoutGenerateKey?db.ref(path):db.ref(path).push();
    await newRef.set(value);
    const newKey = newRef.key;
    console.log(`[PUSH] Success: ${path}/${newKey}`);
    return newKey;
  } catch (err) {
    console.error(`[PUSH] Failed at ${path}:`, err.message);
    return null;
  }
}

/**
 * حذف مسار أو حقل معين
 * @param {string} path 
 */
async function firebaseRemove(path) {
  try {
    await db.ref(path).remove();
    console.log(`[REMOVE] Success: ${path}`);
    return true;
  } catch (err) {
    console.error(`[REMOVE] Failed at ${path}:`, err.message);
    return false;
  }
}

/**
 * قراءة قيمة من مسار معين (مرة واحدة)
 * @param {string} path 
 * @returns {any} القيمة أو null إذا لم توجد
 */
async function firebaseGet(path) {
  try {
    const snap = await db.ref(path).once('value');
    return snap.val();
  } catch (err) {
    console.error(`[GET] Failed at ${path}:`, err.message);
    return null;
  }
}

function fixKnownArrays(data) {
  if (!data) return data;

  // نعمل نسخة لتجنب تعديل الكائن الأصلي
  const fixed = JSON.parse(JSON.stringify(data)); 

  for (const userId in fixed) {
    const user = fixed[userId];
    
    // offers
    if (user.offers && typeof user.offers === 'object') {
      user.offers = Object.values(user.offers);
      // اختياري: ترتيب حسب id أو number
      
    }

    // ratings
    if (user.ratings && typeof user.ratings === 'object' && !Array.isArray(user.ratings)) {
      user.ratings = Object.values(user.ratings);

    }

    // verify.photos
    if (user.verify?.photos && typeof user.verify.photos === 'object' && !Array.isArray(user.verify.photos)) {
      user.verify.photos = Object.values(user.verify.photos);
    }

    // strikes.history
    if (user.strikes?.history && typeof user.strikes.history === 'object' && !Array.isArray(user.strikes.history)) {
      user.strikes.history = Object.values(user.strikes.history);
    }
  }

  return fixed;
}
// تصدير الدوال للاستخدام في باقي الكود
module.exports = {
  firebaseSet,
  firebaseUpdate,
  firebasePush,
  firebaseRemove,
  firebaseGet,
  fixKnownArrays
};