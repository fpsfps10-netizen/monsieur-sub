import { getDb, getCollections } from '../_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const orderId = String(req.query.orderId || '').trim();
    const token = String(req.query.token || '').trim();
    const phone = String(req.query.phone || '').replace(/\s+/g, '');

    if (!orderId || (!token && !phone)) {
      return res.status(400).json({ error: 'Missing orderId or verification credentials' });
    }

    const db = getDb();
    const { privateOrdersCol } = getCollections(db);
    const snap = await privateOrdersCol.doc(orderId).get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = snap.data();
    const validByToken = token && order.accessToken && token === order.accessToken;
    const storedPhone = String(order.customerPhone || '').replace(/\s+/g, '');
    const validByPhone = phone && storedPhone && (storedPhone === phone || storedPhone.endsWith(phone.slice(-9)));

    if (!validByToken && !validByPhone) {
      return res.status(403).json({ error: 'Unauthorized: phone or token mismatch' });
    }

    return res.status(200).json({
      id: order.id,
      status: order.status,
      customerName: order.customerName,
      total: order.total,
      items: order.items || [],
      createdAt: order.createdAt,
      paidAt: order.paidAt || null,
      expiresAt: order.expiresAt || null,
      deliveredCodes: order.status === 'completed' ? (order.deliveredCodes || []) : [],
      outOfStockItems: order.status === 'completed' ? (order.outOfStockItems || []) : [],
    });
  } catch (err) {
    console.error('Order lookup error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
