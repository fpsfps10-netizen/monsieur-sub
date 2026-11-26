export default async function handler(req, res) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();

  if (req.method === "GET") {
    if (req.query?.test === "1") {
      if (!token || !chatId) {
        return res.status(200).json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
      }
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "✅ اختبار ناجح! بوت إشعارات Monsieur Sub يعمل بنجاح." })
      });
      const data = await r.json();
      return res.status(200).json(data);
    }
    return res.status(200).json({ ok: true, configured: Boolean(token && chatId) });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!token || !chatId) {
    return res.status(200).json({ ok: false, skipped: "Telegram env vars not configured" });
  }

  try {
    const order = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const name = String(order.customerName || "زبون").slice(0, 80);
    const phone = String(order.customerPhone || "—").slice(0, 30);
    const payment = String(order.paymentName || "WhatsApp").slice(0, 60);
    const note = String(order.customerNote || "").slice(0, 300);
    const total = Number(order.total) || 0;
    const sourceMap = {
      "cart-wa": "🛒 سلة الموقع",
      "quick-wa": "⚡ طلب سريع"
    };
    const sourceLabel = sourceMap[order.source] || "🛍️ طلب جديد";

    const itemsText = Array.isArray(order.items) && order.items.length
      ? order.items
          .map(i => `• ${i.serviceName || ""} — ${i.planName || ""} (×${i.qty || 1})`)
          .join("\n")
      : "• تفاصيل غير محدّدة";

    const lines = [
      `🔔 طلب جديد في Monsieur Sub`,
      `المصدر: ${sourceLabel}`,
      ``,
      `👤 الزبون: ${name}`,
      `📞 الهاتف: ${phone}`,
      `💳 الدفع: ${payment}`,
      ``,
      `📦 الاشتراكات:`,
      itemsText,
      ``,
      `💰 الإجمالي: ${total.toLocaleString("en-US")} DA`
    ];
    if (note) lines.push(`📝 ملاحظة: ${note}`);

    const cleanPhone = phone.replace(/\D/g, "");
    if (/^(0[567]\d{8}|213[567]\d{8})$/.test(cleanPhone)) {
      const intl = cleanPhone.startsWith("0") ? "213" + cleanPhone.slice(1) : cleanPhone;
      lines.push(``, `💬 تواصل مباشر: https://wa.me/${intl}`);
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        disable_web_page_preview: true
      })
    });

    const data = await tgRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Failed to notify Telegram" });
  }
}
