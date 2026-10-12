import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { PALETTE, monthLabel, money } from '../util.js';

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

// UI-3: pie/doughnut for category spending, line/bar for trends. Each chart is paired with an accessible data table.
export function CategoryPie({ data, currency }) {
  if (!data.length) return <p className="empty">No expenses in this period.</p>;
  return (
    <div className="chart-box" role="img" aria-label={`Spending by category: ${data.map((d) => `${d.category} ${d.percent}%`).join(', ')}`}>
      <Doughnut
        data={{ labels: data.map((d) => d.category), datasets: [{ data: data.map((d) => d.amount), backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2 }] }}
        options={{ plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.raw, currency)} (${data[c.dataIndex].percent}%)` } } }, maintainAspectRatio: false }}
      />
    </div>
  );
}

export function TrendLine({ trend, currency }) {
  return (
    <div className="chart-box" role="img" aria-label="Monthly income and expenses over the last 12 months">
      <Line
        data={{
          labels: trend.map((t) => monthLabel(t.month)),
          datasets: [
            { label: 'Income', data: trend.map((t) => t.income), borderColor: '#0f766e', backgroundColor: '#0f766e22', tension: 0.3, fill: true },
            { label: 'Expenses', data: trend.map((t) => t.expense), borderColor: '#dc2626', backgroundColor: '#dc262622', tension: 0.3, fill: true },
          ],
        }}
        options={{ maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.raw, currency)}` } } } }}
      />
    </div>
  );
}

export function SavingsBar({ trend, currency }) {
  return (
    <div className="chart-box" role="img" aria-label="Net savings per month">
      <Bar
        data={{ labels: trend.map((t) => monthLabel(t.month)), datasets: [{ label: 'Net savings', data: trend.map((t) => t.net), backgroundColor: trend.map((t) => (t.net >= 0 ? '#0f766e' : '#d97706')) }] }}
        options={{ maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${money(c.raw, currency)}` } } } }}
      />
    </div>
  );
}
