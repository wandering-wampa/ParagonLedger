import { useEffect } from "react";

export function usePolling(callback, delay, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let canceled = false;
    const tick = async () => {
      if (!canceled) {
        await callback();
      }
    };
    tick();
    const timer = setInterval(tick, delay);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [callback, delay, enabled]);
}
