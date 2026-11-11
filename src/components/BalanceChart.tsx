import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { CurvePoint } from '../lib/estimate';
import { daysBetween, shortDate } from '../lib/date';

interface BalanceChartProps {
  history: CurvePoint[];
  forecast: CurvePoint[];
  syncedLabel?: string;
}

const W = 338;
const PAD = { top: 22, right: 8, bottom: 26, left: 30 };

interface PlotModel {
  coords: { x: number; y: number; point: CurvePoint }[];
  historyPath: string;
  historyArea: string;
  forecastPath: string;
  todayX: number;
  startX: number;
  endX: number;
  endLabel: string;
  startLabel: string;
  gridLines: { y: number; label: string }[];
  height: number;
}

function buildModel(history: CurvePoint[], forecast: CurvePoint[], height: number): PlotModel | null {
  const points = [...history, ...forecast.slice(1)];
  if (points.length < 2) return null;

  const first = points[0].date;
  const last = points[points.length - 1].date;
  const span = Math.max(daysBetween(first, last), 1);
  const peak = Math.max(...history.map((item) => item.value), 1);
  const maxValue = Math.max(Math.ceil(peak / 50) * 50, 100);

  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const xOf = (date: Date) => PAD.left + (daysBetween(first, date) / span) * plotW;
  const yOf = (value: number) => PAD.top + (1 - value / maxValue) * plotH;

  const coords = points.map((point) => ({ x: xOf(point.date), y: yOf(point.value), point }));
  const historyCoords = coords.slice(0, history.length);

  const historyPath = historyCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const baseline = (height - PAD.bottom).toFixed(1);
  const historyArea = `M${historyCoords[0].x.toFixed(1)},${baseline} L${historyPath.replace(/ /g, ' L')} L${historyCoords[historyCoords.length - 1].x.toFixed(1)},${baseline} Z`;
  const forecastPath = coords
    .slice(history.length - 1)
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');

  const todayX = historyCoords[historyCoords.length - 1].x;
  const end = coords[coords.length - 1];

  const gridLines = [maxValue, maxValue / 2, 0].map((value) => ({
    y: yOf(value),
    label: value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)),
  }));

  return {
    coords,
    historyPath,
    historyArea,
    forecastPath,
    todayX,
    startX: historyCoords[0].x,
    endX: end.x,
    endLabel: shortDate(last),
    startLabel: shortDate(first),
    gridLines,
    height,
  };
}

export function BalanceChart({ history, forecast, syncedLabel }: BalanceChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [height, setHeight] = useState(212);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 图表高度跟着可用空间走，屏幕越高曲线越舒展
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(150, Math.round(entry.contentRect.height));
      setHeight(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => buildModel(history, forecast, height), [history, forecast, height]);

  if (!model) {
    return <div className="chart-empty">还没有足够的用电记录，明天再来看看</div>;
  }

  const handlePointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let distance = Infinity;
    model.coords.forEach((coord, index) => {
      const gap = Math.abs(coord.x - ratio);
      if (gap < distance) {
        distance = gap;
        nearest = index;
      }
    });
    setActive(nearest);
  };

  const activeCoord = active != null ? model.coords[active] : null;
  const endCoord = model.coords[model.coords.length - 1];
  const showStartLabel = model.todayX - model.startX > 52;
  const showTodayLabel = model.endX - model.todayX > 52;
  const bottom = height - PAD.bottom;

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="chart-svg"
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="balanceFade" x1="0" y1={PAD.top} x2="0" y2={bottom} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopOpacity="0.14" />
            <stop offset="100%" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* SVG 空白处默认不接收指针事件，铺一层透明矩形让整块图都能点 */}
        <rect x="0" y="0" width={W} height={height} fill="transparent" pointerEvents="all" />

        {syncedLabel ? (
          <text x={W - PAD.right} y="12" textAnchor="end" className="chart-sync">
            {syncedLabel}
          </text>
        ) : null}

        {model.gridLines.map((line) => (
          <g key={line.label}>
            <line x1={PAD.left} y1={line.y} x2={W - PAD.right} y2={line.y} className="chart-grid" />
            <text
              x={PAD.left - 6}
              y={line.y + 3}
              textAnchor="end"
              className="chart-axis"
            >
              {line.label}
            </text>
          </g>
        ))}

        <path d={model.historyArea} fill="url(#balanceFade)" />
        <polyline points={model.historyPath} className="chart-line-history" />
        <polyline points={model.forecastPath} className="chart-line-forecast" />

        <line
          x1={model.todayX}
          y1={PAD.top}
          x2={model.todayX}
          y2={bottom}
          className="chart-today-line"
        />

        <circle cx={endCoord.x} cy={endCoord.y} r="9" className="chart-end-halo" />
        <circle cx={endCoord.x} cy={endCoord.y} r="3.6" className="chart-end-dot" />

        <text x={model.startX} y={height - 9} textAnchor="middle" className="chart-axis">
          {showStartLabel ? model.startLabel : ''}
        </text>
        <text x={model.todayX} y={height - 9} textAnchor="middle" className="chart-axis chart-axis-today">
          {showTodayLabel ? '今天' : ''}
        </text>
        <text x={model.endX} y={height - 9} textAnchor="end" className="chart-axis chart-axis-end">
          {model.endLabel}
        </text>

        {activeCoord && (
          <line
            x1={activeCoord.x}
            y1={PAD.top}
            x2={activeCoord.x}
            y2={bottom}
            className="chart-active-line"
          />
        )}
        {activeCoord && (
          <circle cx={activeCoord.x} cy={activeCoord.y} r="3.5" className="chart-active-dot" />
        )}
      </svg>

      {activeCoord && (
        <div
          className={`chart-tooltip ${activeCoord.x > W / 2 ? 'chart-tooltip-left' : 'chart-tooltip-right'}`}
          style={{ left: `${(activeCoord.x / W) * 100}%`, top: `${(activeCoord.y / height) * 100}%` }}
        >
          <span className="chart-tooltip-date">{shortDate(activeCoord.point.date)}</span>
          <span className="chart-tooltip-value">{activeCoord.point.value.toFixed(1)} 度</span>
          {activeCoord.point.usage != null && (
            <span className="chart-tooltip-usage">当日用 {activeCoord.point.usage.toFixed(1)} 度</span>
          )}
        </div>
      )}
    </div>
  );
}
