import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface DataPoint {
  timestamp: number;
  [key: string]: number;
}

interface Series {
  key: string;
  label: string;
  color: string;
}

interface Props {
  data: DataPoint[];
  series: Series[];
  title?: string;
  unit?: string;
  height?: number;
}

export function StatChart({ data, series, title, unit = '', height = 120 }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    _t: new Date(d.timestamp).toLocaleTimeString([], { second: '2-digit', minute: '2-digit' }),
  }));

  return (
    <div className="bg-surface-1 border border-zinc-800 rounded-lg p-3">
      {title && <p className="text-xs font-semibold text-zinc-400 mb-2">{title}</p>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={formatted} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
          <XAxis dataKey="_t" tick={{ fontSize: 10, fill: '#71717a' }} />
          <YAxis tick={{ fontSize: 10, fill: '#71717a' }} unit={unit} width={45} />
          <Tooltip
            contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: '#a1a1aa' }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
