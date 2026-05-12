import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-radius-md border border-border-default bg-surface-default px-3 text-body-md text-text-default placeholder:text-text-subtle transition-colors",
        "focus-visible:outline-none focus-visible:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface-canvas",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted",
        "aria-[invalid=true]:border-status-danger aria-[invalid=true]:focus-visible:ring-status-danger",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
