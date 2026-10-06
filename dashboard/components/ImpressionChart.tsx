"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export type DayCount = { day: string; count: number }

export function ImpressionChart({ data }: { data: DayCount[] }) {
  if (data.length === 0) {
    return (
      <p className="rounded border border-dashed p-6 text-center text-sm text-neutral-500">
        No impressions recorded yet.
      </p>
    )
  }
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} allowDecimals={false} tickLine={false} width={28} />
          <Tooltip />
          <Bar dataKey="count" fill="#171717" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
