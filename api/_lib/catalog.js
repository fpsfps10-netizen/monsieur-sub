export const DEFAULT_SERVICES = [
  {
    id: 'netflix',
    name: 'Netflix',
    plans: [
      { id: 'tv', name: 'Pour TV (4K)', prices: { 1: 750, 3: 2100, 6: 3900, 12: 7200 } },
      { id: 'mobile', name: 'Mobile / PC', prices: { 1: 550, 3: 1500, 6: 2800, 12: 5200 } }
    ]
  },
  {
    id: 'spotify',
    name: 'Spotify Premium',
    plans: [
      { id: 'individual', name: 'Individual', prices: { 1: 600, 3: 1600, 6: 2900, 12: 5000 } }
    ]
  },
  {
    id: 'tod',
    name: 'TOD TV',
    plans: [
      { id: 'total', name: 'Total Sports 4K', prices: { 1: 2200, 3: 6000, 6: 11000, 12: 20000 } },
      { id: 'entertainment', name: 'Entertainment', prices: { 1: 1200, 3: 3200, 6: 6000, 12: 10500 } }
    ]
  },
  {
    id: 'showflix',
    name: 'Showflix 1001',
    plans: [
      { id: 'standard', name: 'Standard HD', prices: { 1: 850, 3: 1850, 6: 3200, 12: 4500 } }
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini Plus',
    plans: [
      { id: 'pro', name: 'AI Pro Access', prices: { 1: 1500, 3: 4000, 6: 7500, 12: 14000 } }
    ]
  },
  {
    id: 'iptv-neo',
    name: 'IPTV Neo 4K Pro',
    plans: [
      { id: 'pro4k', name: 'Neo 4K Pro', prices: { 1: 1000, 3: 2000, 6: 3000, 12: 4200 } }
    ]
  }
];

export const DEFAULT_PROMOS = [
  { code: 'SUB10', discount: 10, active: true }
];

export function resolveAuthoritativeCatalog(configData) {
  const services = Array.isArray(configData?.services) && configData.services.length
    ? configData.services
    : DEFAULT_SERVICES;
  const promos = Array.isArray(configData?.promos)
    ? configData.promos
    : DEFAULT_PROMOS;
  return { services, promos };
}
