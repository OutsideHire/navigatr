import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware className combiner. The standard shadcn/ui `cn` helper —
 * shadcn components generated into `components/ui/` import this from `@/lib/utils`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
