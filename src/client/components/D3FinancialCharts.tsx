import React, { useEffect, useRef, useState, useId } from 'react';
import * as d3 from 'd3';
import { 
  TrendingUp, TrendingDown, DollarSign, Calendar, Eye, 
  BarChart2, PieChart, RefreshCw, ArrowUpRight, ArrowDownRight, Layers 
} from 'lucide-react';

export interface MonthlyTrendData {
  month: string;
  fullMonth: string;
  year: number;
  revenue: number;    // centavos
  expenses: number;   // centavos
  netProfit: number;  // centavos
  margin: number;     // percentage
}

export interface ExpenseCategory {
  category: string;
  amount: number;     // centavos
  color: string;
}

interface D3FinancialChartsProps {
  data: MonthlyTrendData[];
  expenseBreakdown?: ExpenseCategory[];
  formatCurrency: (val: number) => string;
}

export default function D3FinancialCharts({ data, expenseBreakdown = [], formatCurrency }: D3FinancialChartsProps) {
  const [timeframe, setTimeframe] = useState<'6M' | '12M' | 'YTD'>('12M');
  const [showRevenue, setShowRevenue] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);
  const [showNetProfit, setShowNetProfit] = useState(true);
  const [activeTab, setActiveTab] = useState<'trends' | 'profitBar' | 'distribution'>('trends');

  // Filter data based on timeframe
  const filteredData = React.useMemo(() => {
    if (!data || data.length === 0) return [];
    if (timeframe === '6M') {
      return data.slice(-6);
    }
    return data;
  }, [data, timeframe]);

  // Totals for filtered period
  const totalPeriodRevenue = filteredData.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalPeriodExpenses = filteredData.reduce((acc, curr) => acc + curr.expenses, 0);
  const totalPeriodNetProfit = totalPeriodRevenue - totalPeriodExpenses;
  const periodMargin = totalPeriodRevenue > 0 ? ((totalPeriodNetProfit / totalPeriodRevenue) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Financial Health Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Total Revenue ({timeframe})</span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
            {formatCurrency(totalPeriodRevenue)}
          </div>
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 mt-2">
            <ArrowUpRight className="w-3.5 h-3.5" /> +12.4% vs previous period
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Total Expenses ({timeframe})</span>
            <div className="p-2 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-lg">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
            {formatCurrency(totalPeriodExpenses)}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1 mt-2">
            Controlled operating burn rate
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Net Operating Income</span>
            <div className={`p-2 rounded-lg ${totalPeriodNetProfit >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'}`}>
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-2xl font-bold font-mono ${totalPeriodNetProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {formatCurrency(totalPeriodNetProfit)}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1 mt-2">
            Bottom line business profit
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Net Profit Margin</span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-lg">
              <BarChart2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
            {periodMargin.toFixed(1)}%
          </div>
          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 mt-2">
            High margin efficiency ratio
          </p>
        </div>
      </div>

      {/* Main Chart Card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm p-6 space-y-6">
        {/* Controls Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700/80 pb-5">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Financial Trend Visualizer (D3.js)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Interactive D3 rendering comparing monthly revenue streams, operational expenses, and net profit margins.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* View Tab Selector */}
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800">
              <button
                onClick={() => setActiveTab('trends')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'trends'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Revenue vs Expense
              </button>
              <button
                onClick={() => setActiveTab('profitBar')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'profitBar'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                Monthly Net Income
              </button>
              <button
                onClick={() => setActiveTab('distribution')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'distribution'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <PieChart className="w-3.5 h-3.5" />
                Expense Allocation
              </button>
            </div>

            {/* Timeframe selector */}
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800">
              <button
                onClick={() => setTimeframe('6M')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  timeframe === '6M'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                6 Months
              </button>
              <button
                onClick={() => setTimeframe('12M')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  timeframe === '12M'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                12 Months
              </button>
            </div>
          </div>
        </div>

        {/* Legend toggles for Line Trend View */}
        {activeTab === 'trends' && (
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-medium text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowRevenue(!showRevenue)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                  showRevenue 
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold' 
                    : 'border-slate-200 dark:border-slate-700 opacity-50'
                }`}
              >
                <span className="w-3 h-3 rounded-full bg-indigo-600 inline-block"></span>
                <span>Revenue Curve</span>
              </button>

              <button
                onClick={() => setShowExpenses(!showExpenses)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                  showExpenses 
                    ? 'bg-rose-50/80 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold' 
                    : 'border-slate-200 dark:border-slate-700 opacity-50'
                }`}
              >
                <span className="w-3 h-3 rounded-full bg-rose-500 inline-block"></span>
                <span>Expenses Curve</span>
              </button>

              <button
                onClick={() => setShowNetProfit(!showNetProfit)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                  showNetProfit 
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold' 
                    : 'border-slate-200 dark:border-slate-700 opacity-50'
                }`}
              >
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
                <span>Net Profit Line</span>
              </button>
            </div>

            <div className="text-slate-400 text-[11px] italic">
              Hover over chart data points to view detailed breakdown
            </div>
          </div>
        )}

        {/* Chart Render Area */}
        <div className="relative w-full min-h-[380px]">
          {activeTab === 'trends' && (
            <D3LineTrendChart 
              data={filteredData} 
              showRevenue={showRevenue} 
              showExpenses={showExpenses} 
              showNetProfit={showNetProfit} 
              formatCurrency={formatCurrency} 
            />
          )}

          {activeTab === 'profitBar' && (
            <D3NetProfitBarChart 
              data={filteredData} 
              formatCurrency={formatCurrency} 
            />
          )}

          {activeTab === 'distribution' && (
            <D3ExpenseDonutChart 
              data={expenseBreakdown} 
              formatCurrency={formatCurrency} 
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 1. D3 LINE & AREA TREND CHART COMPONENT
// ==========================================
interface D3LineTrendChartProps {
  data: MonthlyTrendData[];
  showRevenue: boolean;
  showExpenses: boolean;
  showNetProfit: boolean;
  formatCurrency: (val: number) => string;
}

function D3LineTrendChart({ data, showRevenue, showExpenses, showNetProfit, formatCurrency }: D3LineTrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Generate unique gradient IDs using React.useId() so multiple SVG instances don't collide
  const uid = useId().replace(/:/g, '');
  const revGradId = `revGrad_${uid}`;
  const expGradId = `expGrad_${uid}`;

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data || data.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth || 700;
    const height = 380;
    const margin = { top: 30, right: 30, bottom: 50, left: 75 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height);

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Define X & Y scales
    const xScale = d3.scalePoint<string>()
      .domain(data.map(d => d.month))
      .range([0, chartWidth])
      .padding(0.4);

    // Find max value
    const maxVal = d3.max(data, d => Math.max(d.revenue, d.expenses, d.netProfit)) || 1000000;
    const yScale = d3.scaleLinear()
      .domain([0, maxVal * 1.15])
      .range([chartHeight, 0])
      .nice();

    // Horizontal Grid lines
    const yGrid = d3.axisLeft(yScale)
      .tickSize(-chartWidth)
      .tickFormat(() => '')
      .ticks(6);

    g.append('g')
      .attr('class', 'grid-lines')
      .call(yGrid)
      .selectAll('line')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-opacity', 0.6);

    g.selectAll('.grid-lines .domain').remove();

    // Defs for gradients
    const defs = svg.append('defs');

    const revGrad = defs.append('linearGradient')
      .attr('id', revGradId)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    revGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6366f1').attr('stop-opacity', 0.25);
    revGrad.append('stop').attr('offset', '100%').attr('stop-color', '#6366f1').attr('stop-opacity', 0.0);

    const expGrad = defs.append('linearGradient')
      .attr('id', expGradId)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    expGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.2);
    expGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.0);

    // Line generators
    const lineGenRev = d3.line<MonthlyTrendData>()
      .x(d => xScale(d.month) || 0)
      .y(d => yScale(d.revenue))
      .curve(d3.curveMonotoneX);

    const areaGenRev = d3.area<MonthlyTrendData>()
      .x(d => xScale(d.month) || 0)
      .y0(chartHeight)
      .y1(d => yScale(d.revenue))
      .curve(d3.curveMonotoneX);

    const lineGenExp = d3.line<MonthlyTrendData>()
      .x(d => xScale(d.month) || 0)
      .y(d => yScale(d.expenses))
      .curve(d3.curveMonotoneX);

    const areaGenExp = d3.area<MonthlyTrendData>()
      .x(d => xScale(d.month) || 0)
      .y0(chartHeight)
      .y1(d => yScale(d.expenses))
      .curve(d3.curveMonotoneX);

    const lineGenProfit = d3.line<MonthlyTrendData>()
      .x(d => xScale(d.month) || 0)
      .y(d => yScale(d.netProfit))
      .curve(d3.curveMonotoneX);

    // Draw Revenue Area & Line
    if (showRevenue) {
      g.append('path')
        .datum(data)
        .attr('fill', `url(#${revGradId})`)
        .attr('d', areaGenRev);

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#6366f1') // Indigo
        .attr('stroke-width', 3)
        .attr('d', lineGenRev);

      g.selectAll('.rev-dot')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'rev-dot')
        .attr('cx', d => xScale(d.month) || 0)
        .attr('cy', d => yScale(d.revenue))
        .attr('r', 4)
        .attr('fill', '#ffffff')
        .attr('stroke', '#6366f1')
        .attr('stroke-width', 2);
    }

    // Draw Expenses Area & Line
    if (showExpenses) {
      g.append('path')
        .datum(data)
        .attr('fill', `url(#${expGradId})`)
        .attr('d', areaGenExp);

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#f43f5e') // Rose
        .attr('stroke-width', 3)
        .attr('d', lineGenExp);

      g.selectAll('.exp-dot')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'exp-dot')
        .attr('cx', d => xScale(d.month) || 0)
        .attr('cy', d => yScale(d.expenses))
        .attr('r', 4)
        .attr('fill', '#ffffff')
        .attr('stroke', '#f43f5e')
        .attr('stroke-width', 2);
    }

    // Draw Net Profit Line
    if (showNetProfit) {
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#10b981') // Emerald
        .attr('stroke-width', 2.5)
        .attr('stroke-dasharray', '4 2')
        .attr('d', lineGenProfit);

      g.selectAll('.profit-dot')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'profit-dot')
        .attr('cx', d => xScale(d.month) || 0)
        .attr('cy', d => yScale(d.netProfit))
        .attr('r', 4)
        .attr('fill', '#10b981')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.5);
    }

    // X-Axis
    const xAxis = d3.axisBottom(xScale);
    g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(xAxis)
      .selectAll('text')
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', '#64748b');

    // Y-Axis
    const yAxis = d3.axisLeft(yScale)
      .ticks(6)
      .tickFormat(v => `₱${d3.format('.2s')(Number(v) / 100).replace('G', 'B')}`);

    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#64748b');

    // Remove domain lines
    g.selectAll('.domain').attr('stroke', '#cbd5e1');

    // Tooltip Crosshair & Hover Overlay
    const focusLine = g.append('line')
      .attr('class', 'crosshair')
      .attr('y1', 0)
      .attr('y2', chartHeight)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
      .style('opacity', 0);

    // HTML Tooltip overlay
    const tooltip = d3.select(container).select('.d3-tooltip');

    // Overlay rect for mouse movements
    g.append('rect')
      .attr('width', chartWidth)
      .attr('height', chartHeight)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mousemove', (event) => {
        const [xm] = d3.pointer(event);
        // Find closest point
        let closest: MonthlyTrendData | null = null;
        let minDiff = Infinity;

        data.forEach(d => {
          const cx = xScale(d.month) || 0;
          const diff = Math.abs(cx - xm);
          if (diff < minDiff) {
            minDiff = diff;
            closest = d;
          }
        });

        if (closest) {
          const cx = xScale((closest as MonthlyTrendData).month) || 0;
          focusLine
            .attr('x1', cx)
            .attr('x2', cx)
            .style('opacity', 1);

          tooltip
            .style('opacity', '1')
            .style('left', `${cx + margin.left + 15}px`)
            .style('top', `40px`)
            .html(`
              <div class="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1.5 border border-slate-700 min-w-[170px]">
                <div class="font-bold text-slate-200 border-b border-slate-700 pb-1 flex justify-between">
                  <span>${(closest as MonthlyTrendData).fullMonth}</span>
                  <span class="text-indigo-400 font-mono">${(closest as MonthlyTrendData).margin}% Margin</span>
                </div>
                <div class="flex justify-between items-center text-indigo-300">
                  <span>Revenue:</span>
                  <span class="font-mono font-bold">${formatCurrency((closest as MonthlyTrendData).revenue)}</span>
                </div>
                <div class="flex justify-between items-center text-rose-300">
                  <span>Expenses:</span>
                  <span class="font-mono font-bold">${formatCurrency((closest as MonthlyTrendData).expenses)}</span>
                </div>
                <div class="flex justify-between items-center text-emerald-400 pt-1 border-t border-slate-800">
                  <span>Net Profit:</span>
                  <span class="font-mono font-bold">${formatCurrency((closest as MonthlyTrendData).netProfit)}</span>
                </div>
              </div>
            `);
        }
      })
      .on('mouseleave', () => {
        focusLine.style('opacity', 0);
        tooltip.style('opacity', 0);
      });

  }, [data, showRevenue, showExpenses, showNetProfit, revGradId, expGradId, formatCurrency]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden">
      <svg ref={svgRef} className="w-full h-auto"></svg>
      <div className="d3-tooltip absolute pointer-events-none opacity-0 transition-opacity duration-150 z-20"></div>
    </div>
  );
}

// ==========================================
// 2. D3 MONTHLY NET PROFIT BAR CHART
// ==========================================
interface D3NetProfitBarChartProps {
  data: MonthlyTrendData[];
  formatCurrency: (val: number) => string;
}

function D3NetProfitBarChart({ data, formatCurrency }: D3NetProfitBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data || data.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth || 700;
    const height = 380;
    const margin = { top: 30, right: 30, bottom: 50, left: 75 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height);

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
      .domain(data.map(d => d.month))
      .range([0, chartWidth])
      .padding(0.35);

    const maxProfit = d3.max(data, d => Math.abs(d.netProfit)) || 100000;
    const yScale = d3.scaleLinear()
      .domain([0, maxProfit * 1.2])
      .range([chartHeight, 0])
      .nice();

    // Grid lines
    const yGrid = d3.axisLeft(yScale)
      .tickSize(-chartWidth)
      .tickFormat(() => '')
      .ticks(6);

    g.append('g')
      .attr('class', 'grid-lines')
      .call(yGrid)
      .selectAll('line')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-opacity', 0.6);

    g.selectAll('.grid-lines .domain').remove();

    // Bars
    g.selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => xScale(d.month) || 0)
      .attr('width', xScale.bandwidth())
      .attr('y', d => yScale(Math.max(0, d.netProfit)))
      .attr('height', d => Math.abs(chartHeight - yScale(d.netProfit)))
      .attr('rx', 6)
      .attr('fill', d => d.netProfit >= 0 ? '#10b981' : '#f43f5e')
      .attr('opacity', 0.9)
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 1).attr('stroke', '#0f172a').attr('stroke-width', 2);
        
        d3.select(container).select('.d3-bar-tooltip')
          .style('opacity', '1')
          .style('left', `${(xScale(d.month) || 0) + margin.left}px`)
          .style('top', `${yScale(d.netProfit) + 10}px`)
          .html(`
            <div class="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-mono shadow-xl border border-slate-700">
              <div class="font-bold text-slate-300 mb-1">${d.fullMonth}</div>
              <div class="text-emerald-400">Net: ${formatCurrency(d.netProfit)}</div>
              <div class="text-indigo-300 text-[10px]">Margin: ${d.margin}%</div>
            </div>
          `);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('opacity', 0.9).attr('stroke', 'none');
        d3.select(container).select('.d3-bar-tooltip').style('opacity', '0');
      });

    // Bar Labels on top
    g.selectAll('.bar-label')
      .data(data)
      .enter()
      .append('text')
      .attr('x', d => (xScale(d.month) || 0) + xScale.bandwidth() / 2)
      .attr('y', d => yScale(d.netProfit) - 8)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('font-weight', '700')
      .style('fill', '#475569')
      .text(d => `${d.margin}%`);

    // Axes
    const xAxis = d3.axisBottom(xScale);
    g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(xAxis)
      .selectAll('text')
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', '#64748b');

    const yAxis = d3.axisLeft(yScale)
      .ticks(6)
      .tickFormat(v => `₱${d3.format('.2s')(Number(v) / 100).replace('G', 'B')}`);

    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#64748b');

  }, [data, formatCurrency]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden">
      <svg ref={svgRef} className="w-full h-auto"></svg>
      <div className="d3-bar-tooltip absolute pointer-events-none opacity-0 transition-opacity duration-150 z-20"></div>
    </div>
  );
}

// ==========================================
// 3. D3 EXPENSE DONUT CHART
// ==========================================
interface D3ExpenseDonutChartProps {
  data: ExpenseCategory[];
  formatCurrency: (val: number) => string;
}

function D3ExpenseDonutChart({ data, formatCurrency }: D3ExpenseDonutChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCategory, setHoveredCategory] = useState<ExpenseCategory | null>(null);

  const totalExpenseAmount = data.reduce((acc, curr) => acc + curr.amount, 0);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data || data.length === 0) return;

    const width = 320;
    const height = 320;
    const radius = Math.min(width, height) / 2 - 10;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);

    const pie = d3.pie<ExpenseCategory>()
      .value(d => d.amount)
      .sort(null);

    const arc = d3.arc<d3.PieArcDatum<ExpenseCategory>>()
      .innerRadius(radius * 0.62)
      .outerRadius(radius);

    const arcHover = d3.arc<d3.PieArcDatum<ExpenseCategory>>()
      .innerRadius(radius * 0.62)
      .outerRadius(radius + 8);

    const arcs = g.selectAll('.arc')
      .data(pie(data))
      .enter()
      .append('g')
      .attr('class', 'arc');

    arcs.append('path')
      .attr('d', arc)
      .attr('fill', d => d.data.color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s ease')
      .on('mouseenter', function (event, d) {
        d3.select(this).transition().duration(200).attr('d', arcHover as any);
        setHoveredCategory(d.data);
      })
      .on('mouseleave', function () {
        d3.select(this).transition().duration(200).attr('d', arc as any);
        setHoveredCategory(null);
      });

  }, [data]);

  return (
    <div ref={containerRef} className="flex flex-col md:flex-row items-center justify-around gap-6 p-4">
      {/* Donut graphic */}
      <div className="relative w-[300px] h-[300px] flex items-center justify-center">
        <svg ref={svgRef} className="w-full h-full"></svg>
        {/* Center Label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            {hoveredCategory ? hoveredCategory.category : 'Total Expense'}
          </span>
          <span className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">
            {hoveredCategory 
              ? formatCurrency(hoveredCategory.amount) 
              : formatCurrency(totalExpenseAmount)}
          </span>
          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
            {hoveredCategory 
              ? `${((hoveredCategory.amount / totalExpenseAmount) * 100).toFixed(1)}% Share` 
              : `${data.length} Categories`}
          </span>
        </div>
      </div>

      {/* Legend Table */}
      <div className="flex-1 space-y-2.5 max-w-md">
        <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">
          Expense Category Breakdown
        </h4>
        {data.map((cat) => {
          const pct = ((cat.amount / totalExpenseAmount) * 100).toFixed(1);
          const isHovered = hoveredCategory?.category === cat.category;

          return (
            <div 
              key={cat.category}
              onMouseEnter={() => setHoveredCategory(cat)}
              onMouseLeave={() => setHoveredCategory(null)}
              className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                isHovered 
                  ? 'bg-slate-50 dark:bg-slate-700/60 border-slate-300 dark:border-slate-600 shadow-sm' 
                  : 'bg-white dark:bg-slate-800/40 border-slate-100 dark:border-slate-700/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }}></span>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{cat.category}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(cat.amount)}</span>
                <span className="text-slate-400 text-[11px] min-w-[40px] text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
