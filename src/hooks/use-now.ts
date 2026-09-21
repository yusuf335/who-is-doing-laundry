"use client";

import { useEffect, useState } from "react";

/** A clock that re-renders on an interval, so countdowns tick without any data churn. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
