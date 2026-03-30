'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface WhaleChartProps {
  data: { outcome: string; value: number }[];
}

const COLORS = ['#F59E0B', '#22C55E', '#60A5FA', '#EF4444', '#A78BFA', '#FB923C'];

export default function WhaleChart({ data }: WhaleChartProps) {
  return (
    <div className="h-64 md:h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#2D3340" horizontal={false} />
          <XAxis
            type="number"
            stroke="#5C6578"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => {
              if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
              if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
              return `$${value}`;
            }}
          />
          <YAxis
            dataKey="outcome"
            type="category"
            stroke="#5C6578"
            fontSize={11}
            width={84}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) => value.length > 11 ? value.slice(0, 11) + '…' : value}
          />
          <Tooltip
            cursor={{ fill: 'rgba(45, 51, 64, 0.4)' }}
            contentStyle={{
              backgroundColor: '#1C2028',
              border: '1px solid #2D3340',
              borderRadius: '8px',
              color: '#FFFFFF',
              fontSize: 13,
            }}
            labelStyle={{ color: '#9099AB' }}
            itemStyle={{ color: '#FFFFFF' }}
            formatter={(value) => [`$${Number(value ?? 0).toLocaleString()}`, 'Whale Volume']}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]}>
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
