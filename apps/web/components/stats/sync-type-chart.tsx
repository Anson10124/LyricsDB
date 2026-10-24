"use client";

import { Label, Pie, PieChart } from "recharts";
import type { LibraryStatsTotals } from "@repo/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCount, formatPercent, SYNC_TYPES } from "./stats-format";

const chartConfig = Object.fromEntries(
  SYNC_TYPES.map(({ key, label, color }) => [key, { label, color }]),
) satisfies ChartConfig;

export function SyncTypeChart({ totals }: { totals: LibraryStatsTotals }) {
  const data = SYNC_TYPES.map(({ key }) => ({
    key,
    value: totals[key],
    fill: `var(--color-${key})`,
  }));
  // Zero slices would only add stray separators to the ring
  const slices = data.filter((d) => d.value > 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Sync type</CardTitle>
        <CardDescription>How every cached track is timed</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-5">
        <ChartContainer
          config={chartConfig}
          className="aspect-square w-full max-w-[200px] shrink-0"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  nameKey="key"
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2.5 rounded-[2px]"
                          style={{ background: `var(--color-${name})` }}
                        />
                        {chartConfig[name as keyof typeof chartConfig]?.label}
                      </span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {formatCount(Number(value))} ·{" "}
                        {formatPercent(Number(value), totals.tracks)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="key"
              innerRadius="62%"
              outerRadius="100%"
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !("cx" in viewBox)) return null;
                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground text-2xl font-semibold tabular-nums"
                      >
                        {formatCount(totals.tracks)}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 20}
                        className="fill-muted-foreground text-xs"
                      >
                        tracks
                      </tspan>
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>

        <ul className="grid w-full gap-2 text-sm">
          {SYNC_TYPES.map(({ key, label, color }) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: color }}
                />
                {label}
              </span>
              <span className="tabular-nums">
                <span className="font-medium">
                  {formatPercent(totals[key], totals.tracks)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatCount(totals[key])}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
