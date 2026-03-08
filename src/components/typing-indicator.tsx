"use client";

interface TypingIndicatorProps {
  label: string;
  className?: string;
}

export function TypingIndicator({ label, className = "" }: TypingIndicatorProps) {
  return (
    <div className={`flex justify-start ${className}`.trim()}>
      <div className="max-w-xs rounded-2xl rounded-bl-md border border-slate-200 bg-slate-100 px-4 py-3 text-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
          </div>
          <span className="text-xs font-medium">{label}</span>
        </div>
      </div>
    </div>
  );
}
