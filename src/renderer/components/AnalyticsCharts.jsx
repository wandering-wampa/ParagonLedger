import React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export function AnalyticsCharts({ dashboard }) {
  return (
    <div className="charts-grid">
      <article className="card chart-card">
        <h3>Influence Over Time</h3>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={dashboard?.influenceByDay ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#283139" />
            <XAxis dataKey="day" stroke="#8fa2b2" />
            <YAxis stroke="#8fa2b2" />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="total"
              stroke="#40d9a5"
              strokeWidth={2}
              name="Influence"
            />
          </LineChart>
        </ResponsiveContainer>
      </article>
    </div>
  );
}
