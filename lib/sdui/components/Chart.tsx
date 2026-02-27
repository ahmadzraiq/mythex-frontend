'use client';

import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type ChartType = 'line' | 'bar' | 'pie';

interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface ChartProps {
  chartType?: ChartType;
  data?: ChartDataPoint[];
  dataKey?: string;
  colors?: string[];
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const DEFAULT_DATA: ChartDataPoint[] = [
  { name: 'Jan', value: 40 },
  { name: 'Feb', value: 65 },
  { name: 'Mar', value: 52 },
  { name: 'Apr', value: 78 },
  { name: 'May', value: 60 },
  { name: 'Jun', value: 90 },
];

const DEFAULT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const Chart = React.forwardRef<HTMLDivElement, ChartProps>(
  (
    {
      chartType = 'bar',
      data = DEFAULT_DATA,
      dataKey = 'value',
      colors = DEFAULT_COLORS,
      className = '',
      style,
      ...rest
    },
    ref,
  ) => {
    const chartData = data?.length ? data : DEFAULT_DATA;

    const renderChart = () => {
      if (chartType === 'line') {
        return (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey} stroke={colors[0]} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        );
      }
      if (chartType === 'pie') {
        return (
          <PieChart>
            <Pie data={chartData} dataKey={dataKey} nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={colors[idx % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        );
      }
      return (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey={dataKey} fill={colors[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      );
    };

    return (
      <div ref={ref} style={style} className={`w-full h-[240px] ${className}`} {...rest}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    );
  },
);

Chart.displayName = 'Chart';
export default Chart;
