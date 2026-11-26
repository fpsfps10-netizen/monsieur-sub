import admin from 'firebase-admin';

let cachedDb = null;

export function getAppId() {
  return process.env.APP_ID || 'monsieur-sub';
}

export function getDb() {
  if (cachedDb) return cachedDb;

  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable');
    }
    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  cachedDb = admin.firestore();
  return cachedDb;
}

export function getCollections(db) {
  const appId = getAppId();
  const base = db.collection('artifacts').doc(appId);
  return {
    configDoc: base.collection('public').doc('data').collection('store').doc('config'),
    publicOrdersCol: base.collection('public').doc('data').collection('orders'),
    privateOrdersCol: base.collection('private').doc('data').collection('orders'),
    codesCol: base.collection('private').doc('data').collection('codes'),
  };
}
