import crypto from 'crypto';
import { getDb, getCollections } from '../_lib/firebase.js';
import { resolveAuthoritativeCatalog } from '../_lib/catalog.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const secretKey = process.env.CHARGILY_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: 'Missing CHARGILY_SECRET_KEY on server' });
    }

    const { items = [], customer = {}, promoCode = '' } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    if (!customer.name || !customer.phone) {
      return res.status(400).json({ error: 'Customer name and phone are required' });
    }

    const db = getDb();
    const { configDoc, privateOrdersCol, publicOrdersCol } = getCollections(db);

    const cfgSnap = await configDoc.get();
    const { services, promos } = resolveAuthoritativeCatalog(cfgSnap.exists ? cfgSnap.data() : null);

    const validatedItems = [];
    let subtotal = 0;

    for (const rawItem of items) {
      const qty = Math.max(1, Math.min(20, parseInt(rawItem.qty, 10) || 1));
      const months = parseInt(rawItem.months, 10);
      const svc = services.find((s) => s.id === rawItem.serviceId);
      if (!svc) {
        return res.status(400).json({ error: `Unknown service: ${rawItem.serviceId}` });
      }
      const plan = (svc.plans || []).find((p) => p.id === rawItem.planId) || svc.plans?.[0];
      if (!plan) {
        return res.status(400).json({ error: `Unknown plan for ${svc.name}` });
      }
      const unitPrice = Number(plan.prices?.[months] ?? plan.prices?.[String(months)]);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({ error: `Invalid duration (${months}m) for ${svc.name}` });
      }

      subtotal += unitPrice * qty;
      validatedItems.push({
        serviceId: svc.id,
        serviceName: svc.name,
        planId: plan.id,
        planName: plan.name,
        months,
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
      });
    }

    let appliedPromo = null;
    let discountAmount = 0;
    const cleanCode = String(promoCode || '').trim().toUpperCase();
    if (cleanCode) {
      const found = promos.find((p) => p.active && String(p.code).toUpperCase() === cleanCode);
      if (found) {
        const pct = Math.max(0, Math.min(90, Number(found.discount) || 0));
        discountAmount = Math.round((subtotal * pct) / 100);
        appliedPromo = { code: found.code, discount: pct };
      }
    }

    const total = Math.max(75, subtotal - discountAmount);
    const orderId = 'MS-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const accessToken = crypto.randomBytes(16).toString('hex');
    const cleanPhone = String(customer.phone).replace(/\s+/g, '');

    const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
    const isTest = process.env.CHARGILY_MODE === 'test' || secretKey.startsWith('test_sk_');
    const apiBase = isTest
      ? 'https://pay.chargily.net/test/api/v2/checkouts'
      : 'https://pay.chargily.net/api/v2/checkouts';

    const chargilyRes = await fetch(apiBase, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: total,
        currency: 'dzd',
        success_url: `${siteUrl}/?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(accessToken)}&pay=success`,
        failure_url: `${siteUrl}/?orderId=${encodeURIComponent(orderId)}&pay=failed`,
        webhook_endpoint: `${siteUrl}/api/chargily/webhook`,
        description: `Monsieur Sub Order ${orderId}`,
        locale: customer.lang === 'fr' ? 'fr' : 'ar',
        metadata: {
          orderId,
          phone: cleanPhone,
        },
      }),
    });

    const chargilyData = await chargilyRes.json();
    if (!chargilyRes.ok || !chargilyData.checkout_url) {
      console.error('Chargily error:', chargilyData);
      return res.status(502).json({
        error: chargilyData.message || 'Failed to create Chargily checkout session',
      });
    }

    const nowIso = new Date().toISOString();
    const privateOrder = {
      id: orderId,
      accessToken,
      checkoutId: chargilyData.id,
      customerName: String(customer.name).trim(),
      customerPhone: cleanPhone,
      customerEmail: String(customer.email || '').trim(),
      items: validatedItems,
      subtotal,
      discountAmount,
      promoCode: appliedPromo?.code || '',
      total,
      paymentMethod: 'chargily',
      status: 'pending',
      deliveredCodes: [],
      createdAt: nowIso,
    };

    const publicSummary = {
      id: orderId,
      customerName: privateOrder.customerName,
      customerPhone: cleanPhone,
      itemsSummary: validatedItems.map((i) => `${i.serviceName} (${i.planName} - ${i.months}m) x${i.qty}`).join(' + '),
      months: Math.max(...validatedItems.map((i) => i.months)),
      total,
      paymentMethod: 'chargily',
      promoCode: privateOrder.promoCode,
      status: 'pending',
      createdAt: nowIso,
    };

    await Promise.all([
      privateOrdersCol.doc(orderId).set(privateOrder),
      publicOrdersCol.doc(orderId).set(publicSummary),
    ]);

    return res.status(200).json({
      orderId,
      token: accessToken,
      checkoutUrl: chargilyData.checkout_url,
    });
  } catch (err) {
    console.error('Create checkout error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
