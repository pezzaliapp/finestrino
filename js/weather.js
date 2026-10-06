// Meteo e ricerca luoghi: Open-Meteo, gratuito senza chiave per uso non commerciale.
import { t, LANG } from './i18n.js';

export async function fetchWeather(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&current=temperature_2m,cloud_cover,weather_code,wind_speed_10m,is_day&timezone=auto';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  return json.current;
}

const WMO = {
  0: 'sereno', 1: 'quasi sereno', 2: 'poco nuvoloso', 3: 'coperto',
  45: 'nebbia', 48: 'nebbia gelata',
  51: 'pioviggine', 53: 'pioviggine', 55: 'pioviggine fitta',
  61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte',
  66: 'pioggia gelata', 67: 'pioggia gelata',
  71: 'neve debole', 73: 'neve', 75: 'neve forte', 77: 'nevischio',
  80: 'rovesci', 81: 'rovesci', 82: 'rovesci forti',
  85: 'neve a rovesci', 86: 'neve a rovesci',
  95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con grandine',
};

export function describeWeather(code) {
  return WMO[code] ? t(WMO[code]) : '';
}

export async function searchPlaces(query) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(query)}&count=6&language=${LANG}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ricerca HTTP ${res.status}`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
