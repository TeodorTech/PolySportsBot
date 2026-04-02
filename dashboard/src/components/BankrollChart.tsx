'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

export interface BankrollPoint {
  label: string;   // e.g. event index or short date
  overall: number | null;
  conviction: number | null;
}

interface Props {
  data: BankrollPoint[];
  bankroll: number;
}

function formatDollar(value: number) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export default function BankrollChart({ data, bankroll }: Props) {
  return (
    <div className="h-72 md:h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2D3340" />
          <XAxis
            dataKey="label"
            stroke="#5C6578"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#5C6578"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatDollar}
            width={56}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1C2028',
              border: '1px solid #2D3340',
              borderRadius: '8px',
              color: '#FFFFFF',
              fontSize: 13,
            }}
            labelStyle={{ color: '#9099AB' }}
            itemStyle={{ color: '#FFFFFF' }}
            formatter={(value: number, name: string) => [
              formatDollar(value),
              name === 'overall' ? '$100/event' : '$250/event (conviction)',
            ]}
          />
          <ReferenceLine y={bankroll} stroke="#2D3340" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="overall"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#F59E0B' }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="conviction"
            stroke="#22C55E"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#22C55E' }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
