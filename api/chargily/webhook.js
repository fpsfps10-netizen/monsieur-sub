import crypto from 'crypto';
import { getDb, getCollections } from '../_lib/firebase.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
  } catch (e) {
    console.error('Telegram send failed:', e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const secretKey = process.env.CHARGILY_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).send('Missing CHARGILY_SECRET_KEY');
    }

    const rawBody = await readRawBody(req);
    const signature = req.headers['signature'];
    if (!signature) {
      return res.status(401).send('Missing signature header');
    }

    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(String(signature), 'utf8');
    const compBuf = Buffer.from(computed, 'utf8');
    if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
      return res.status(403).send('Invalid signature');
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    if (event.type !== 'checkout.paid') {
      return res.status(200).json({ received: true, ignored: event.type });
    }

    const orderId = event.data?.metadata?.orderId;
    if (!orderId) {
      return res.status(400).send('Missing orderId in metadata');
    }

    const db = getDb();
    const { privateOrdersCol, publicOrdersCol, codesCol } = getCollections(db);
    const orderRef = privateOrdersCol.doc(orderId);
    const publicRef = publicOrdersCol.doc(orderId);

    let resultData = null;

    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        throw new Error(`Order ${orderId} not found`);
      }

      const order = orderSnap.data();
      if (order.status === 'completed') {
        resultData = { alreadyCompleted: true, order };
        return;
      }

      const deliveredCodes = [];
      const outOfStockItems = [];
      const nowIso = new Date().toISOString();

      for (const item of order.items || []) {
        const q = codesCol
          .where('serviceId', '==', item.serviceId)
          .where('planId', '==', item.planId)
          .where('months', '==', Number(item.months))
          .where('status', '==', 'available')
          .limit(item.qty);

        const stockSnap = await tx.get(q);
        const docs = stockSnap.docs;

        for (const doc of docs) {
          const codeData = doc.data();
          tx.update(doc.ref, {
            status: 'sold',
            orderId,
            buyerPhone: order.customerPhone,
            soldAt: nowIso,
          });
          deliveredCodes.push({
            serviceName: item.serviceName,
            planName: item.planName,
            months: item.months,
            code: codeData.code,
          });
        }

        if (docs.length < item.qty) {
          outOfStockItems.push({
            serviceName: item.serviceName,
            planName: item.planName,
            months: item.months,
            missing: item.qty - docs.length,
          });
        }
      }

      const maxMonths = Math.max(1, ...(order.items || []).map((i) => Number(i.months) || 1));
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + maxMonths);
      const expiresAt = expDate.toISOString();

      tx.update(orderRef, {
        status: 'completed',
        paidAt: nowIso,
        expiresAt,
        deliveredCodes,
        outOfStockItems,
        chargilyEventId: event.id || '',
      });

      tx.set(
        publicRef,
        {
          status: 'completed',
          paidAt: nowIso,
          expiresAt,
          deliveredCount: deliveredCodes.length,
          missingStock: outOfStockItems.length > 0,
        },
        { merge: true }
      );

      resultData = {
        alreadyCompleted: false,
        order,
        deliveredCodes,
        outOfStockItems,
        expiresAt,
      };
    });

    if (resultData && !resultData.alreadyCompleted) {
      const { order, deliveredCodes, outOfStockItems } = resultData;
      const itemsText = (order.items || [])
        .map((i) => `• ${i.serviceName} (${i.planName} - ${i.months}m) ×${i.qty}`)
        .join('\n');

      let msg =
        `✅ <b>عملية بيع جديدة — Monsieur Sub</b>\n` +
        `🧾 رقم الطلب: <code>${orderId}</code>\n` +
        `👤 الزبون: ${order.customerName}\n` +
        `📱 الهاتف: <code>${order.customerPhone}</code>\n` +
        `💰 المبلغ: <b>${order.total} DA</b> (Chargily Pay)\n\n` +
        `📦 <b>المنتجات:</b>\n${itemsText}\n\n` +
        `🔑 الأكواد المسلّمة تلقائياً: <b>${deliveredCodes.length}</b>`;

      if (outOfStockItems.length > 0) {
        const warn = outOfStockItems
          .map((x) => `⚠️ ${x.serviceName} (${x.planName} - ${x.months}m): ناقص ${x.missing}`)
          .join('\n');
        msg += `\n\n🚨 <b>تنبيه نفاد مخزون! يجب التسليم يدوياً للزبون:</b>\n${warn}`;
      }

      await sendTelegram(msg);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send(err.message || 'Webhook processing error');
  }
}
