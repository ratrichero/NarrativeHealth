'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendArrowProps {
  direction: 'improving' | 'declining' | 'stable';
  change7d:  number;
  size?:     'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const ICON_SIZE = { sm: 'h-3 w-3', md: 'h-4 w-4', lg: 'h-5 w-5' };
const TEXT_SIZE = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };

export function TrendArrow({
  direction,
  change7d,
  size = 'md',
  showLabel = true,
}: TrendArrowProps) {
  const isPos = change7d >= 0;
  const label = `${isPos ? '+' : ''}${change7d.toFixed(1)}`;

  if (direction === 'improving') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-green-500')}>
        <TrendingUp className={ICON_SIZE[size]} />
        {showLabel && <span className={cn('font-medium tabular-nums', TEXT_SIZE[size])}>{label}</span>}
      </span>
    );
  }

  if (direction === 'declining') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-red-500')}>
        <TrendingDown className={ICON_SIZE[size]} />
        {showLabel && <span className={cn('font-medium tabular-nums', TEXT_SIZE[size])}>{label}</span>}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-gray-400')}>
      <Minus className={ICON_SIZE[size]} />
      {showLabel && <span className={cn('font-medium tabular-nums', TEXT_SIZE[size])}>{label}</span>}
    </span>
  );
}
