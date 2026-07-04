import { useEffect, useMemo, useRef, useState } from 'react';
import { setHoverPoint, useApp } from '../state/store';
import {
  fmtDistance,
  fmtDuration,
  fmtElevation,
  fmtGrade,
} from '../lib/geo';
import type { ProfilePoint, Units } from '../types';

const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 20;
const HEIGHT = 150;

function gradeColor(g: number): string {
  const a = Math.abs(g);
  if (a < 0.05) return '#4ade80';
  if (a < 0.1) return '#facc15';
  if (a < 0.15) return '#fb923c';
  if (a < 0.2) return '#f87171';
  return '#dc2626';
}

export default function ElevationPanel() {
  const profile = useApp((s) => s.profile);
  const stats = useApp((s) => s.stats);
  const units = useApp((s) => s.units);
  const busy = useApp((s) => s.profileBusy);
  const [collapsed, setCollapsed] = useState(false);

  if (!profile || !stats || profile.length < 2) return null;

  return (
    <div className={`elev-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="elev-header">
        <div className="elev-stats">
          <span className="chip">
            <b>{fmtDistance(stats.distance, units)}</b>
          </span>
          <span className="chip chip-gain">↑ {fmtElevation(stats.gain, units)}</span>
          <span className="chip chip-loss">↓ {fmtElevation(stats.loss, units)}</span>
          <span className="chip">⏱ {fmtDuration(stats.movingTimeSec)}</span>
          <span className="chip">
            ⛰ {fmtElevation(stats.maxEle, units)} max
          </span>
          {busy && <span className="chip chip-busy">updating…</span>}
        </div>
        <div className="elev-legend">
          <span style={{ color: '#4ade80' }}>■</span>&lt;5%
          <span style={{ color: '#facc15' }}>■</span>5–10%
          <span style={{ color: '#fb923c' }}>■</span>10–15%
          <span style={{ color: '#f87171' }}>■</span>15–20%
          <span style={{ color: '#dc2626' }}>■</span>&gt;20%
        </div>
        <button className="elev-collapse" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▲ Profile' : '▼'}
        </button>
      </div>
      {!collapsed && <Chart profile={profile} units={units} />}
    </div>
  );
}

function Chart({ profile, units }: { profile: ProfilePoint[]; units: Units }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = profile[profile.length - 1].dist;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of profile) {
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }
  const range = Math.max(10, maxEle - minEle);
  minEle -= range * 0.05;
  maxEle += range * 0.05;

  const x = (d: number) => PAD_L + (d / total) * (width - PAD_L - PAD_R);
  const y = (e: number) =>
    PAD_T + (1 - (e - minEle) / (maxEle - minEle)) * (HEIGHT - PAD_T - PAD_B);

  const { areaPath, gradePaths, xTicks, yTicks } = useMemo(() => {
    let area = `M ${x(profile[0].dist)} ${HEIGHT - PAD_B}`;
    for (const p of profile) area += ` L ${x(p.dist).toFixed(1)} ${y(p.ele).toFixed(1)}`;
    area += ` L ${x(total).toFixed(1)} ${HEIGHT - PAD_B} Z`;

    // group consecutive samples by grade color to limit path count
    const paths: { color: string; d: string }[] = [];
    let curColor = gradeColor(profile[0].grade);
    let d = `M ${x(profile[0].dist).toFixed(1)} ${y(profile[0].ele).toFixed(1)}`;
    for (let i = 1; i < profile.length; i++) {
      const c = gradeColor(profile[i].grade);
      d += ` L ${x(profile[i].dist).toFixed(1)} ${y(profile[i].ele).toFixed(1)}`;
      if (c !== curColor) {
        paths.push({ color: curColor, d });
        curColor = c;
        d = `M ${x(profile[i].dist).toFixed(1)} ${y(profile[i].ele).toFixed(1)}`;
      }
    }
    paths.push({ color: curColor, d });

    // x ticks in display units
    const unitM = units === 'imperial' ? 1609.344 : 1000;
    const totalUnits = total / unitM;
    const stepOptions = [0.5, 1, 2, 5, 10, 20, 50, 100];
    const step = stepOptions.find((s) => totalUnits / s <= 8) ?? 100;
    const xt: { pos: number; label: string }[] = [];
    for (let u = step; u < totalUnits; u += step) {
      xt.push({ pos: x(u * unitM), label: String(Math.round(u * 10) / 10) });
    }

    const yt: { pos: number; label: string }[] = [];
    for (let k = 0; k <= 3; k++) {
      const e = minEle + ((maxEle - minEle) * k) / 3;
      yt.push({ pos: y(e), label: fmtElevation(e, units) });
    }
    return { areaPath: area, gradePaths: paths, xTicks: xt, yTicks: yt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, width, units]);

  const onMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const d = ((px - PAD_L) / (width - PAD_L - PAD_R)) * total;
    if (d < 0 || d > total) {
      onLeave();
      return;
    }
    // binary search nearest sample
    let lo = 0;
    let hi = profile.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (profile[mid].dist <= d) lo = mid;
      else hi = mid;
    }
    const idx = d - profile[lo].dist < profile[hi].dist - d ? lo : hi;
    setHoverIdx(idx);
    const p = profile[idx];
    setHoverPoint({ lngLat: p.lngLat, dist: p.dist, ele: p.ele, grade: p.grade });
  };

  const onLeave = () => {
    setHoverIdx(null);
    setHoverPoint(null);
  };

  const hover = hoverIdx != null ? profile[hoverIdx] : null;

  return (
    <div className="chart-wrap" ref={containerRef} onMouseMove={onMove} onMouseLeave={onLeave}>
      <svg width={width} height={HEIGHT}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={width - PAD_R}
              y1={t.pos}
              y2={t.pos}
              stroke="rgba(255,255,255,0.08)"
            />
            <text x={PAD_L - 6} y={t.pos + 3} textAnchor="end" className="chart-tick">
              {t.label}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.pos}
              x2={t.pos}
              y1={PAD_T}
              y2={HEIGHT - PAD_B}
              stroke="rgba(255,255,255,0.05)"
            />
            <text x={t.pos} y={HEIGHT - 6} textAnchor="middle" className="chart-tick">
              {t.label}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="rgba(56,189,248,0.12)" />
        {gradePaths.map((p, i) => (
          <path key={i} d={p.d} stroke={p.color} strokeWidth={2.2} fill="none" />
        ))}
        {hover && (
          <g>
            <line
              x1={x(hover.dist)}
              x2={x(hover.dist)}
              y1={PAD_T}
              y2={HEIGHT - PAD_B}
              stroke="rgba(255,255,255,0.5)"
              strokeDasharray="3 3"
            />
            <circle cx={x(hover.dist)} cy={y(hover.ele)} r={4} fill="#fff" />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(width - 170, Math.max(0, x(hover.dist) + 8)),
          }}
        >
          {fmtDistance(hover.dist, units)} · {fmtElevation(hover.ele, units)} ·{' '}
          {fmtGrade(hover.grade)}
        </div>
      )}
    </div>
  );
}
