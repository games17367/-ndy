// Wetter über Open-Meteo (kostenlos, kein API-Schlüssel nötig).

import { fetchWithTimeout } from './http-utils.js';

const CODES = {
  0: 'klar',
  1: 'überwiegend klar',
  2: 'teils bewölkt',
  3: 'bedeckt',
  45: 'Nebel',
  48: 'Reifnebel',
  51: 'leichter Nieselregen',
  53: 'Nieselregen',
  55: 'starker Nieselregen',
  56: 'gefrierender Nieselregen',
  57: 'starker gefrierender Nieselregen',
  61: 'leichter Regen',
  63: 'Regen',
  65: 'starker Regen',
  66: 'gefrierender Regen',
  67: 'starker gefrierender Regen',
  71: 'leichter Schneefall',
  73: 'Schneefall',
  75: 'starker Schneefall',
  77: 'Schneegriesel',
  80: 'leichte Regenschauer',
  81: 'Regenschauer',
  82: 'heftige Regenschauer',
  85: 'leichte Schneeschauer',
  86: 'starke Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit leichtem Hagel',
  99: 'Gewitter mit Hagel',
};

export function describeCode(code) {
  return CODES[code] || 'unbekanntes Wetter';
}

export async function geocode(config, name, signal) {
  const url = `${config.weather.geocodingBaseUrl}/v1/search?name=${encodeURIComponent(name)}&count=1&language=de&format=json`;
  const res = await fetchWithTimeout(url, {}, 8000, signal);
  if (!res.ok) throw new Error('Ortssuche fehlgeschlagen.');
  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit) throw new Error(`Den Ort „${name}“ habe ich nicht gefunden.`);
  return {
    name: hit.name,
    region: hit.admin1 || '',
    country: hit.country || '',
    lat: hit.latitude,
    lon: hit.longitude,
  };
}

/**
 * Liefert strukturierte Wetterdaten für die Anzeige-Karte.
 * Entweder per Ortsname oder per Koordinaten.
 */
export async function getWeather(config, { location, coords }, signal) {
  let place;
  if (location && String(location).trim()) {
    place = await geocode(config, String(location).trim(), signal);
  } else if (coords) {
    place = { name: 'Dein Standort', region: '', country: '', lat: coords.lat, lon: coords.lon };
  } else {
    throw new Error('Ich weiß nicht, für welchen Ort. Nenne mir eine Stadt oder erlaube den Standort.');
  }

  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '3',
    wind_speed_unit: 'kmh',
  });
  const res = await fetchWithTimeout(`${config.weather.forecastBaseUrl}/v1/forecast?${params}`, {}, 8000, signal);
  if (!res.ok) throw new Error('Der Wetterdienst antwortet gerade nicht.');
  const d = await res.json();
  const cur = d.current || {};
  const daily = d.daily || {};
  const days = (daily.time || []).map((date, i) => ({
    date,
    text: describeCode(daily.weather_code?.[i]),
    code: daily.weather_code?.[i],
    max: Math.round(daily.temperature_2m_max?.[i]),
    min: Math.round(daily.temperature_2m_min?.[i]),
    rain: daily.precipitation_probability_max?.[i] ?? null,
  }));
  return {
    place: [place.name, place.region].filter(Boolean).join(', '),
    current: {
      temp: Math.round(cur.temperature_2m),
      feels: Math.round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m,
      wind: Math.round(cur.wind_speed_10m),
      rain: cur.precipitation,
      code: cur.weather_code,
      text: describeCode(cur.weather_code),
    },
    days,
  };
}

export function weatherToText(w) {
  const c = w.current;
  const dayNames = ['heute', 'morgen', 'übermorgen'];
  const lines = [
    `Ort: ${w.place}. Jetzt: ${c.text}, ${c.temp} Grad (gefühlt ${c.feels}), Luftfeuchte ${c.humidity} Prozent, Wind ${c.wind} km/h.`,
  ];
  w.days.forEach((day, i) => {
    lines.push(
      `${dayNames[i] || day.date}: ${day.text}, ${day.min} bis ${day.max} Grad${day.rain != null ? `, Regenwahrscheinlichkeit ${day.rain} Prozent` : ''}.`
    );
  });
  return lines.join('\n');
}
