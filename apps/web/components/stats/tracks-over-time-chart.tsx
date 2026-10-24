"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { LibraryDailyStats } from "@repo/types";
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
import { formatCount } from "./stats-format";

const chartConfig = {
  total: { label: "Cached tracks", color: "var(--primary)" },
} satisfies ChartConfig;

// Dates are UTC days; format them in UTC so they don't shift a day locally
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const parseDay = (date: string) => new Date(`${date}T00:00:00Z`);

// Walk back from today's total, subtracting each later day's additions, to get
// the library size at the end of every day in the window
function toRunningTotals(days: LibraryDailyStats[], total: number) {
  let remaining = total;
  return [...days]
    .reverse()
    .map((day) => {
      const point = { date: day.date, total: remaining };
      remaining -= day.count;
      return point;
    })
    .reverse();
}

export function TracksOverTimeChart({
  days,
  total,
}: {
  days: LibraryDailyStats[];
  total: number;
}) {
  const points = toRunningTotals(days, total);
  const added = days.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Tracks over time</CardTitle>
        <CardDescription>
          Last 30 days · {formatCount(total)} cached (+{formatCount(added)})
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-full min-h-56 w-full"
        >
          <AreaChart data={points} margin={{ top: 8, left: 0, right: 8 }}>
            <defs>
              <linearGradient id="fill-total" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              tickFormatter={(value: string) => shortDate.format(parseDay(value))}
            />
            <YAxis
              width={40}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => compactCount.format(value)}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) => {
                    const date = payload?.[0]?.payload?.date as string | undefined;
                    return date ? longDate.format(parseDay(date)) : null;
                  }}
                />
              }
            />
            <Area
              dataKey="total"
              type="monotone"
              stroke="var(--color-total)"
              strokeWidth={2}
              fill="url(#fill-total)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
