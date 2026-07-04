// Point forecasts from Open-Meteo (free, no API key). Elevation-aware:
// Open-Meteo adjusts the forecast for the terrain elevation of the point.
import type { LngLat, Units } from '../types';

export interface DailyForecast {
  date: string;
  code: number;
  tMax: number;
  tMin: number;
  precipSum: number;
  precipProbMax: number;
  windMax: number;
  sunrise: string;
  sunset: string;
}

export interface Forecast {
  elevation: number; // meters, model elevation of the point
  daily: DailyForecast[];
}

export async function fetchForecast(lngLat: LngLat, units: Units): Promise<Forecast> {
  const imperial = units === 'imperial';
  const params = new URLSearchParams({
    latitude: lngLat[1].toFixed(4),
    longitude: lngLat[0].toFixed(4),
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    forecast_days: '5',
    timezone: 'auto',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    precipitation_unit: imperial ? 'inch' : 'mm',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`weather failed (${res.status})`);
  const j = await res.json();
  const d = j.daily;
  const daily: DailyForecast[] = (d.time as string[]).map((date: string, i: number) => ({
    date,
    code: d.weather_code[i],
    tMax: d.temperature_2m_max[i],
    tMin: d.temperature_2m_min[i],
    precipSum: d.precipitation_sum[i],
    precipProbMax: d.precipitation_probability_max?.[i] ?? 0,
    windMax: d.wind_speed_10m_max[i],
    sunrise: d.sunrise[i],
    sunset: d.sunset[i],
  }));
  return { elevation: j.elevation ?? 0, daily };
}

export function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Mixed';
}
