"use client";

interface TypingIndicatorProps {
  label: string;
  className?: string;
}

export function TypingIndicator({ label, className = "" }: TypingIndicatorProps) {
  return (
    <div className={`flex justify-start ${className}`.trim()}>
      <div className="inline-flex max-w-fit items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100/95 px-3 py-2 text-[11px] font-medium text-slate-500 shadow-sm">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
        </div>
        <span className="leading-none">{label}</span>
      </div>
    </div>
  );
}
