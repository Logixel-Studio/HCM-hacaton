import { cn } from "@/lib/utils";

const variants = {
  outline: "border border-line bg-surface text-ink-soft hover:text-ink hover:bg-surface-muted",
  ghost: "text-ink-soft hover:text-ink hover:bg-surface-muted",
  solid: "bg-brand-600 text-white hover:bg-brand-700",
  muted: "bg-surface-muted text-ink-soft hover:text-ink",
};

export function IconButton({ className, variant = "outline", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={cn("inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30", variants[variant], className)}
      {...props}
    />
  );
}
