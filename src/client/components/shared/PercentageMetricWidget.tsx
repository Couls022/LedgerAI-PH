import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { PercentageMetricItem, PercentageTone } from '../../utils/dateFilterUtils';

const TONE_STYLES: Record<
  PercentageTone,
  { stroke: string; bar: string; text: string; track: string }
> = {
  teal: {
    stroke: 'stroke-teal-600 dark:stroke-teal-400',
    bar: 'bg-teal-600 dark:bg-teal-400',
    text: 'text-teal-700 dark:text-teal-300',
    track: 'stroke-slate-200 dark:stroke-slate-800',
  },
  blue: {
    stroke: 'stroke-blue-600 dark:stroke-sky-400',
    bar: 'bg-blue-600 dark:bg-sky-400',
    text: 'text-blue-700 dark:text-sky-300',
    track: 'stroke-slate-200 dark:stroke-slate-800',
  },
  amber: {
    stroke: 'stroke-amber-600 dark:stroke-amber-400',
    bar: 'bg-amber-600 dark:bg-amber-400',
    text: 'text-amber-700 dark:text-amber-300',
    track: 'stroke-slate-200 dark:stroke-slate-800',
  },
  rose: {
    stroke: 'stroke-rose-600 dark:stroke-rose-400',
    bar: 'bg-rose-600 dark:bg-rose-400',
    text: 'text-rose-700 dark:text-rose-300',
    track: 'stroke-slate-200 dark:stroke-slate-800',
  },
  neutral: {
    stroke: 'stroke-slate-400 dark:stroke-slate-600',
    bar: 'bg-slate-300 dark:bg-slate-700',
    text: 'text-slate-500 dark:text-slate-400',
    track: 'stroke-slate-200 dark:stroke-slate-800',
  },
};

export default function PercentageMetricWidget({ metric }: { metric: PercentageMetricItem }) {
  const styles = TONE_STYLES[metric.tone];
  const size = 52;
  const strokeWidth = 4.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (metric.ringFillPercent / 100) * circumference;

  return (
    <div
      data-testid={`percentage-widget-${metric.id}`}
      className="bg-white dark:bg-[#11192B] border border-slate-200/90 dark:border-[#1E2D45] rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3 card-hover hover:border-slate-300 dark:hover:border-[#334766]"
      title={metric.formula}
    >
      <div className="space-y-2.5">
        {/* Full-width label row prevents clipping on 1280px/1440px 4-column grids */}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight">
          {metric.label}
        </p>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              className={`text-2xl font-bold font-mono tabular-nums tracking-tight leading-none ${
                metric.percentage === null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-50'
              }`}
            >
              {metric.displayValue}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
              {metric.subtitle}
            </p>
          </div>

          {/* Clean SVG Percentage Ring */}
          <div className="relative shrink-0 w-[52px] h-[52px] flex items-center justify-center">
            <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                className={styles.track}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className={`${styles.stroke} transition-all duration-300`}
              />
            </svg>
            <span className={`absolute text-[10px] font-mono font-bold tabular-nums ${styles.text}`}>
              {metric.percentage === null
                ? '—'
                : Math.abs(metric.percentage) < 10 && metric.percentage % 1 !== 0
                  ? `${metric.percentage.toFixed(1)}%`
                  : `${Math.round(metric.percentage)}%`}
            </span>
          </div>
        </div>
      </div>

      {/* Subtle Bottom Progress & Drill-Down */}
      <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#1B2942]">
        <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#1B2942] overflow-hidden">
          <div
            className={`h-full rounded-full ${styles.bar} transition-all duration-300`}
            style={{ width: `${metric.ringFillPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap">
            {metric.percentage === null ? 'Awaiting records' : 'Verified Ledger'}
          </span>
          <Link
            to={metric.drillDownPath}
            className={`font-semibold hover:underline inline-flex items-center gap-0.5 whitespace-nowrap shrink-0 ${styles.text}`}
          >
            {metric.drillDownLabel}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
